import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

// Is what is live the same as what is in this repo?
//
// Water Base ships in two halves. The app and the database go out on a push
// and a migration; the edge functions go out on their own. Everything a
// customer reads on a quote, an agreement or a work order is built by
// send-agreement, so a wording change is not live until that function is
// deployed, however green every other check is.
//
// This exists because that gap went unnoticed for eight days in September
// 2026. Quotes printed the short build sheet name while the long one sat
// correct in the database, and five finished changes queued behind one deploy
// that kept failing with:
//
//   Your account does not have the necessary privileges to access this
//   endpoint.
//
// That was read as a missing permission. It was the wrong account: the token
// on the machine could not see the Water Base project at all. The same 403
// covers both, so the only way to tell them apart is to ask the token what it
// can see, which is step 2 below.
//
// Run with: npm run check:deploy

const API = 'https://api.supabase.com'
const FUNCTIONS = ['send-agreement']

let failed = 0
function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

function envValue(key) {
  if (process.env[key]) return process.env[key].trim()
  if (!existsSync('.env.local')) return ''
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at > 0 && line.slice(0, at).trim() === key) return line.slice(at + 1).trim()
  }
  return ''
}

// The project this app actually talks to, so a token is checked against the
// project in use rather than one somebody typed from memory.
// Everything runs inside main so the script can return rather than call
// process.exit. Exiting while a fetch handle is still open aborts Node on
// Windows with a libuv assertion, which turns a clear failure into a crash.
async function main() {
const url = envValue('VITE_SUPABASE_URL')
const ref = url ? new URL(url).hostname.split('.')[0] : ''
const token = envValue('SUPABASE_ACCESS_TOKEN')

console.log(`project this app talks to: ${ref || '(unknown)'}\n`)

if (!ref) {
  console.log('  FAIL  VITE_SUPABASE_URL is not set, so there is no project to check against.')
  return 1
}

if (!token) {
  console.log('  FAIL  No SUPABASE_ACCESS_TOKEN. Generate one at supabase.com under')
  console.log('        Account, Access Tokens, from the account that owns this project,')
  console.log('        then set SUPABASE_ACCESS_TOKEN. Nothing can be deployed without it.')
  return 1
}

const auth = { Authorization: `Bearer ${token}` }

// --- 1. does the token work at all -------------------------------------------

const projectsRes = await fetch(`${API}/v1/projects`, { headers: auth }).catch(e => ({ ok: false, status: String(e) }))
if (!projectsRes.ok) {
  console.log(`  FAIL  The token was refused by Supabase (${projectsRes.status}). It may be expired or revoked.`)
  return 1
}
const projects = await projectsRes.json()
check('the token is accepted by Supabase', Array.isArray(projects), `${projects?.length ?? 0} projects visible`)

// --- 2. can it see THIS project ------------------------------------------------
//
// The step that was missing. A token with no access to a project gives the
// same 403 as a token with the wrong role on the right one, so the error alone
// cannot tell you which you have. This can.

const mine = (projects || []).some(p => p.id === ref)
check(`the token can see ${ref}`, mine,
  mine ? '' : `it can see: ${(projects || []).map(p => `${p.name} (${p.id})`).join(', ') || 'nothing'}`)

if (!mine) {
  console.log('')
  console.log('  This token belongs to an account that cannot see the Water Base project.')
  console.log('  No extra permission on it will help. Generate a token from the account')
  console.log('  that owns the project above, and set SUPABASE_ACCESS_TOKEN to it.')
  console.log('')
  console.log(`\n${failed} deploy check(s) failed.`)
  process.exit(1)
}

// --- 3. is what is deployed what is in this repo -------------------------------

// The Management API does not hand back the deployed source, so the files
// cannot be compared line by line from here. What it does give is when the
// function was last deployed, and git knows when its code last changed. Code
// newer than the deploy is exactly the failure this file exists for: finished,
// merged, correct in the database, and not what a customer is reading.
//
// An earlier version of this check guessed instead, looking for the last long
// line of each file inside the deployed bundle. Three files reported a match
// while they were eight days stale, because the line it picked had not
// changed. A check that passes when it should fail is worse than no check, so
// it was replaced with a question that has an exact answer.

for (const slug of FUNCTIONS) {
  const dir = join('supabase', 'functions', slug)
  if (!existsSync(dir)) { check(`${slug} exists in this repo`, false, dir); continue }

  const res = await fetch(`${API}/v1/projects/${ref}/functions/${slug}`, { headers: auth })
    .catch(e => ({ ok: false, status: String(e) }))

  if (!res.ok) {
    check(`${slug}: the deployed copy could be read`, false,
      `Supabase answered ${res.status}. Cannot tell whether what is live matches this repo.`)
    continue
  }

  const live = await res.json()
  const deployedAt = new Date(live.updated_at)

  // The commit that last touched this function, rather than file mtimes, which
  // a fresh checkout resets to today and would report everything as stale.
  let changedAt = null
  try {
    const iso = execSync(`git log -1 --format=%cI -- ${dir}`, { encoding: 'utf8' }).trim()
    if (iso) changedAt = new Date(iso)
  } catch { changedAt = null }

  const dirty = (() => {
    try { return execSync(`git status --porcelain -- ${dir}`, { encoding: 'utf8' }).trim() !== '' }
    catch { return false }
  })()

  const day = d => d.toISOString().slice(0, 10)

  check(`${slug}: nothing uncommitted`, !dirty,
    dirty ? 'there are local edits to this function that no deploy can have included' : '')

  if (changedAt) {
    const fresh = deployedAt >= changedAt
    check(`${slug}: deployed since its code last changed`, fresh,
      fresh
        ? `deployed ${day(deployedAt)}, code last changed ${day(changedAt)}, v${live.version}`
        : `code changed ${day(changedAt)} but the live copy is from ${day(deployedAt)} (v${live.version}). `
          + 'Whatever it prints is the old wording. Deploy it.')
  } else {
    check(`${slug}: the code's history could be read`, false, 'git log returned nothing for this folder')
  }
}

console.log(failed === 0
  ? '\nWhat is deployed matches this repo.'
  : `\n${failed} deploy check(s) failed. Nothing customer facing is safe to call shipped until these pass.`)
return failed === 0 ? 0 : 1
}

process.exitCode = await main()
