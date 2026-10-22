// Apply the migrations that have not been applied.
//
// Water Base has had three ways to run a migration and all of them needed a
// person: a connector that can stop answering, an access token that was for
// the wrong account for eight days, and a CLI that wants a database password
// nobody has written down. Schema changes sat unapplied for days at a time
// because of the plumbing rather than because of the change.
//
// This is the same answer the edge functions already use. The deploy workflow
// holds a token that can see this project, so the migration runs where the
// token lives and the result is proved afterwards.
//
// It writes to supabase_migrations.schema_migrations, which is the table
// Supabase's own tooling reads. Applying a migration here and applying it
// through the dashboard or the CLI leave the same record, so the history does
// not fork depending on who ran it.
//
// Usage:
//   node scripts/migrate.js            apply what is pending
//   node scripts/migrate.js --dry-run  say what would run, change nothing

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API = 'https://api.supabase.com'
const DIR = 'supabase/migrations'

function envValue(key) {
  if (process.env[key]) return process.env[key].trim()
  if (!existsSync('.env.local')) return ''
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at > 0 && line.slice(0, at).trim() === key) return line.slice(at + 1).trim()
  }
  return ''
}

const token = envValue('SUPABASE_ACCESS_TOKEN')
const url = envValue('VITE_SUPABASE_URL')
const ref = envValue('SUPABASE_PROJECT_REF') || (url ? new URL(url).hostname.split('.')[0] : '')

async function run(sql) {
  const res = await fetch(`${API}/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })

  const text = await res.text()

  if (!res.ok) {
    let detail = text.slice(0, 600)
    try { detail = JSON.parse(text).message ?? detail } catch { /* keep the raw body */ }
    throw new Error(detail)
  }

  try { return JSON.parse(text) } catch { return [] }
}

// The version is the 14 digit prefix, which is what Supabase keys its history
// on. A file without one is a mistake rather than a migration, and is said so
// rather than skipped quietly.
function versionOf(name) {
  const match = name.match(/^(\d{14})_/)
  return match ? match[1] : null
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  if (!ref) {
    console.error('No project. Set SUPABASE_PROJECT_REF or VITE_SUPABASE_URL.')
    return 1
  }

  if (!token) {
    console.error('No SUPABASE_ACCESS_TOKEN, so there is nothing to authenticate with.')
    return 1
  }

  // The wrong account gives the same 403 as a missing permission, which is the
  // mistake that cost eight days in September. Ask what this token can see
  // before blaming anything else.
  const seen = await fetch(`${API}/v1/projects`, { headers: { Authorization: `Bearer ${token}` } })

  if (!seen.ok) {
    console.error(`Supabase refused the token (${seen.status}). It may be expired or revoked.`)
    return 1
  }

  const projects = await seen.json()

  const visible = Array.isArray(projects) ? projects : []

  if (!visible.some(p => p.id === ref)) {
    console.error(`This token cannot see ${ref}. It can see: `
      + `${visible.map(p => `${p.name} (${p.id})`).join(', ') || 'nothing'}.`)
    console.error('It belongs to a different account. No extra permission on it will help.')
    return 1
  }

  const files = readdirSync(DIR).filter(name => name.endsWith('.sql')).sort()
  const bad = files.filter(name => !versionOf(name))

  if (bad.length > 0) {
    console.error(`These files have no 14 digit prefix, so they have no place in the history: ${bad.join(', ')}`)
    return 1
  }

  await run(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, name text, statements text[], created_by text);`)

  const applied = new Set(
    (await run('select version from supabase_migrations.schema_migrations'))
      .map(row => String(row.version)))

  const pending = files.filter(name => !applied.has(versionOf(name)))

  console.log(`${files.length} migration(s) on disk, ${applied.size} already applied, ${pending.length} pending\n`)

  if (pending.length === 0) {
    console.log('Nothing to do.')
    return 0
  }

  for (const name of pending) {
    const version = versionOf(name)
    console.log(`  ${dryRun ? 'would apply' : 'applying'}  ${name}`)

    if (dryRun) continue

    const sql = readFileSync(join(DIR, name), 'utf8')

    try {
      await run(sql)
    } catch (caught) {
      // Stop on the first failure rather than carrying on. A later migration
      // usually assumes an earlier one ran, so continuing turns one clear
      // error into several confusing ones.
      console.error(`\n  ${name} failed and nothing after it was attempted.`)
      console.error(`  ${caught.message}`)
      return 1
    }

    await run(`insert into supabase_migrations.schema_migrations (version, name)
      values ('${version}', '${name.replace(/'/g, "''")}')
      on conflict (version) do nothing`)

    console.log(`  applied     ${name}`)
  }

  console.log(`\n${dryRun ? 'Nothing was changed.' : `${pending.length} migration(s) applied.`}`)
  return 0
}

process.exitCode = await main()
