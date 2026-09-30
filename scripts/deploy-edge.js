import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

// Deploy one edge function, and write down what was deployed.
//
// The writing down is the point. Supabase can say when a function was last
// deployed and what version it is on, but not what is inside it, so "is the
// live copy the code in this repo" had no exact answer. Comparing the deploy
// time against the last commit looks like one and is not: deploying and then
// committing, which is the normal order, makes every function look stale.
//
// So each deploy records the sha256 of every file it sent, and the version
// Supabase gave back. check:deploy compares today's files against that record,
// which is exact, and the recorded version against the live one, which catches
// a deploy made some other way.
//
// Usage:
//   npm run deploy:edge send-agreement
//   npm run deploy:edge            (every function)

const API = 'https://api.supabase.com'
export const STAMP = 'deployed.json'

function envValue(key) {
  if (process.env[key]) return process.env[key].trim()
  if (!existsSync('.env.local')) return ''
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at > 0 && line.slice(0, at).trim() === key) return line.slice(at + 1).trim()
  }
  return ''
}

// Line endings are normalised before hashing. Git hands these files out with
// CRLF on Windows and the deploy sends them as they sit on disk, so hashing
// the raw bytes would make the same code hash differently on two machines.
export function fileHashes(dir) {
  const out = {}
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.ts')) continue
    const text = readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n')
    out[name] = createHash('sha256').update(text).digest('hex')
  }
  return out
}

/**
 * The Supabase access token, and a refusal when there are two of them.
 *
 * envValue prefers the environment over .env.local, so a stale token exported
 * in a shell silently beats a good one written in the file. That is the same
 * shape of fault as the wrong account itself: something correct is present,
 * something wrong is in front of it, and nothing says so. Two different values
 * stop the run rather than quietly picking one.
 */
export function accessToken() {
  const fromEnv = (process.env.SUPABASE_ACCESS_TOKEN || '').trim()
  let fromFile = ''
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const at = line.indexOf('=')
      if (at > 0 && line.slice(0, at).trim() === 'SUPABASE_ACCESS_TOKEN') fromFile = line.slice(at + 1).trim()
    }
  }

  if (fromEnv && fromFile && fromEnv !== fromFile) {
    return {
      token: '',
      clash: 'There are two different SUPABASE_ACCESS_TOKEN values: one in the environment '
        + `(${fromEnv.slice(0, 8)}...) and a different one in .env.local (${fromFile.slice(0, 8)}...). `
        + 'The environment one would win. Remove whichever is stale so there is one answer.',
    }
  }

  return { token: fromEnv || fromFile, clash: '' }
}

export function functionDirs() {
  const root = join('supabase', 'functions')
  return readdirSync(root).filter(name => existsSync(join(root, name, 'index.ts')))
}

async function main() {
  // SUPABASE_PROJECT_REF first, for CI, which has no .env.local. Locally the
  // ref is read off the URL the app actually talks to, so a deploy cannot go
  // to a project the app does not use.
  const url = envValue('VITE_SUPABASE_URL')
  const ref = envValue('SUPABASE_PROJECT_REF') || (url ? new URL(url).hostname.split('.')[0] : '')
  const { token, clash } = accessToken()

  if (clash) {
    console.error(clash)
    return 1
  }
  if (!ref) {
    console.error('Neither SUPABASE_PROJECT_REF nor VITE_SUPABASE_URL is set, so there is no project to deploy to.')
    return 1
  }
  if (!token) {
    console.error('No SUPABASE_ACCESS_TOKEN. Generate one at supabase.com under Account,')
    console.error('Access Tokens, from the account that owns this project.')
    return 1
  }

  // The same wrong account trap check:deploy guards. A token that cannot see
  // this project fails with a message about privileges, which reads like a
  // permission to be raised rather than an account to be changed.
  const projects = await (await fetch(`${API}/v1/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json().catch(() => [])

  if (!Array.isArray(projects) || !projects.some(p => p.id === ref)) {
    console.error(`This token cannot see ${ref}. It can see: `
      + `${(projects || []).map(p => `${p.name} (${p.id})`).join(', ') || 'nothing'}.`)
    console.error('It belongs to a different account. No extra permission on it will help.')
    return 1
  }

  const wanted = process.argv.slice(2)
  const slugs = wanted.length > 0 ? wanted : functionDirs()

  for (const slug of slugs) {
    const dir = join('supabase', 'functions', slug)
    if (!existsSync(dir)) { console.error(`${slug}: no such function in this repo`); return 1 }

    console.log(`\ndeploying ${slug}...`)
    execSync(`npx supabase functions deploy ${slug} --project-ref ${ref}`, { stdio: 'inherit' })

    const live = await (await fetch(`${API}/v1/projects/${ref}/functions/${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json()

    writeFileSync(join(dir, STAMP), `${JSON.stringify({
      note: 'Written by npm run deploy:edge. What was last deployed, so check:deploy '
        + 'can tell whether the live copy is this code. Do not edit by hand.',
      slug,
      project: ref,
      version: live.version,
      deployed_at: live.updated_at,
      files: fileHashes(dir),
    }, null, 2)}\n`)

    console.log(`${slug}: deployed as v${live.version} and recorded`)
  }

  return 0
}

// Only when run as a command. check:deploy imports the two helpers above, and
// an import that deployed something would be a trap.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main()
}
