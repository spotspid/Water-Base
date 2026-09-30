import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { STAMP, fileHashes } from './deploy-edge.js'

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
// Every function, not just the one that burned us. ghl-sync, notify and
// docuseal-webhook can go stale the same way and nobody would see it, because
// nothing they do is visible on a page.
const FUNCTIONS = ['send-agreement', 'ghl-sync', 'notify', 'docuseal-webhook']

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

// Supabase can say when a function was deployed and what version it is on,
// but not what is inside it, so the comparison is made against the record each
// deploy leaves behind: deployed.json, holding the sha256 of every file sent
// and the version Supabase gave back.
//
// Two earlier versions of this check guessed, and both were wrong in the
// direction that matters. The first looked for each file's last long line
// inside the deployed bundle and passed three files that were eight days
// stale, because the line it picked had not changed. The second compared the
// deploy time against the last commit, and failed two functions that were
// perfectly current, because deploying and then committing is the normal order
// and leaves the commit looking newer. A check that cries wolf gets ignored as
// surely as one that sleeps, so both were replaced with a hash.

for (const slug of FUNCTIONS) {
  const dir = join('supabase', 'functions', slug)
  if (!existsSync(dir)) { check(`${slug} exists in this repo`, false, dir); continue }

  const stampPath = join(dir, STAMP)
  if (!existsSync(stampPath)) {
    check(`${slug}: there is a record of what was deployed`, false,
      `no ${STAMP}. Deploy with npm run deploy:edge ${slug}, which writes one.`)
    continue
  }

  const stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
  const now = fileHashes(dir)

  // 1. Is the code today the code that was deployed?
  const changed = []
  for (const name of new Set([...Object.keys(now), ...Object.keys(stamp.files || {})])) {
    if (now[name] !== stamp.files?.[name]) changed.push(name)
  }
  check(`${slug}: the code here is what was deployed`, changed.length === 0,
    changed.length === 0
      ? `v${stamp.version}, ${Object.keys(now).length} files`
      : `${changed.join(', ')} changed since the last deploy. Whatever it prints is the old `
        + `version. Run npm run deploy:edge ${slug}.`)

  // 2. Is the live version the one that record describes? A mismatch means
  //    somebody deployed another way, so the record no longer proves anything.
  const res = await fetch(`${API}/v1/projects/${ref}/functions/${slug}`, { headers: auth })
    .catch(e => ({ ok: false, status: String(e) }))

  if (!res.ok) {
    check(`${slug}: the live version could be read`, false, `Supabase answered ${res.status}`)
    continue
  }

  const live = await res.json()
  check(`${slug}: the live version matches that record`, live.version === stamp.version,
    live.version === stamp.version
      ? ''
      : `live is v${live.version}, the record says v${stamp.version}. Someone deployed outside `
        + `npm run deploy:edge, so nothing here can prove what is live. Redeploy through it.`)
}

console.log(failed === 0
  ? '\nWhat is deployed matches this repo.'
  : `\n${failed} deploy check(s) failed. Nothing customer facing is safe to call shipped until these pass.`)
return failed === 0 ? 0 : 1
}

process.exitCode = await main()
