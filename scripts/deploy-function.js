// Deploys one edge function from disk to Supabase.
//
// Exists because the alternative is retyping the source into a tool call,
// which is how a deployed function quietly stops matching the file it came
// from. This reads the directory and sends exactly what is on disk.
//
// Usage:
//   node scripts/deploy-function.js notify
//   node scripts/deploy-function.js notify --no-verify-jwt
//
// Needs SUPABASE_ACCESS_TOKEN (a personal access token, sbp_...) and
// SUPABASE_PROJECT_REF in the environment.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const API = 'https://api.supabase.com'

function fail(message) {
  console.error(message)
  process.exit(1)
}

const slug = process.argv[2]
const verifyJwt = !process.argv.includes('--no-verify-jwt')

if (!slug) fail('Which function? node scripts/deploy-function.js <name> [--no-verify-jwt]')

const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = process.env.SUPABASE_PROJECT_REF

if (!token) fail('SUPABASE_ACCESS_TOKEN is not set. It is a personal access token, sbp_...')
if (!ref) fail('SUPABASE_PROJECT_REF is not set.')

const dir = join('supabase', 'functions', slug)

let names
try {
  names = readdirSync(dir).filter(n => n.endsWith('.ts') || n.endsWith('.json'))
} catch (caught) {
  fail(`Cannot read ${dir}. ${caught.message}`)
}

if (!names.includes('index.ts')) fail(`${dir} has no index.ts, so there is no entrypoint.`)

const form = new FormData()

form.append('metadata', JSON.stringify({
  name: slug,
  entrypoint_path: 'index.ts',
  verify_jwt: verifyJwt,
}))

for (const name of names) {
  const path = join(dir, name)
  if (!statSync(path).isFile()) continue
  const body = readFileSync(path)
  form.append('file', new File([body], name, { type: 'application/typescript' }))
  console.log(`  ${name}  ${body.length} bytes`)
}

const res = await fetch(
  `${API}/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`,
  { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
)

const detail = await res.text()

if (!res.ok) fail(`Deploy failed with ${res.status}.\n${detail}`)

let parsed = null
try { parsed = JSON.parse(detail) } catch { /* the body was not JSON */ }

console.log(parsed
  ? `Deployed ${slug} version ${parsed.version}, verify_jwt ${parsed.verify_jwt}, status ${parsed.status}.`
  : `Deployed ${slug}. ${detail}`)
