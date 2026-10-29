// Takes the v2 partition off this project.
//
// A rebuild was built as a second schema beside public, on the plan that the
// cutover would be two renames. It is not going ahead, and three things it
// left behind have to come off in a particular order:
//
//   1. v2 comes out of PostgREST's exposed schemas
//   2. the schema itself is dropped, with its rows in the migration ledger
//   3. send-agreement-v2, the edge function that only ever served it, is deleted
//
// One before two, and not the other way round. PostgREST is configured with a
// list of schemas to serve, and dropping a schema that is still on that list
// leaves the API pointed at something that does not exist. The cost of being
// wrong about how it reacts is the whole REST API for a live business, so the
// order is the cheap way to never find out.
//
// Run where the token lives. See .github/workflows/remove-v2.yml.
//
//   node scripts/remove-v2.js --dry-run   says what it would do
//   node scripts/remove-v2.js             does it

const API = 'https://api.supabase.com'
const DRY = process.argv.includes('--dry-run')

const token = (process.env.SUPABASE_ACCESS_TOKEN || '').trim()
const ref = (process.env.SUPABASE_PROJECT_REF || '').trim()

function die(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

if (!token) die('No SUPABASE_ACCESS_TOKEN, so there is nothing to authenticate with.')
if (!ref) die('No SUPABASE_PROJECT_REF, so there is no project to act on.')

async function call(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }

  return { ok: res.ok, status: res.status, body }
}

const sql = async statement => call(`/v1/projects/${ref}/database/query`, {
  method: 'POST',
  body: JSON.stringify({ query: statement }),
})

function step(n, what) {
  console.log(`\n${n}. ${what}`)
}

// --- 1. the exposed schemas -------------------------------------------------

async function unexposeV2() {
  step(1, 'Take v2 out of the schemas PostgREST serves')

  const current = await call(`/v1/projects/${ref}/postgrest`)
  if (!current.ok) die(`Could not read the API settings. ${JSON.stringify(current.body)}`)

  const served = String(current.body?.db_schema || '')
  const schemas = served.split(',').map(s => s.trim()).filter(Boolean)

  console.log(`   serving now: ${schemas.join(', ') || '(nothing)'}`)

  if (!schemas.includes('v2')) {
    console.log('   v2 is not on the list, so there is nothing to remove')
    return
  }

  const kept = schemas.filter(s => s !== 'v2')

  // public is what the entire app talks to. If it is somehow not on the list,
  // stop: writing this back would be a different and much worse change.
  if (!kept.includes('public')) {
    die('public is not among the exposed schemas. Refusing to write that back.')
  }

  console.log(`   serving after: ${kept.join(', ')}`)

  if (DRY) return

  const patched = await call(`/v1/projects/${ref}/postgrest`, {
    method: 'PATCH',
    body: JSON.stringify({ db_schema: kept.join(', ') }),
  })

  if (!patched.ok) die(`Could not update the API settings. ${JSON.stringify(patched.body)}`)

  const after = await call(`/v1/projects/${ref}/postgrest`)
  const now = String(after.body?.db_schema || '')

  if (now.split(',').map(s => s.trim()).includes('v2')) {
    die(`The setting did not take: it still reads "${now}".`)
  }

  console.log(`   done, and read back as "${now}"`)
}

// --- the live API still answers --------------------------------------------

/**
 * Asks the REST API for a row the app reads on every page load.
 *
 * This is the check the ordering above exists for. It runs after the schema
 * list changes and again after the drop, because "the API is fine" is the one
 * claim worth proving twice rather than assuming once.
 */
async function restStillWorks(when) {
  const keys = await call(`/v1/projects/${ref}/api-keys`)
  const anon = Array.isArray(keys.body)
    ? keys.body.find(k => k.name === 'anon' || k.type === 'publishable')
    : null

  if (!anon?.api_key) {
    console.log(`   (could not read an anon key, so the REST check was skipped ${when})`)
    return
  }

  const res = await fetch(
    `https://${ref}.supabase.co/rest/v1/settings_options?select=list_key&limit=1`,
    { headers: { apikey: anon.api_key, Authorization: `Bearer ${anon.api_key}` } },
  )

  if (!res.ok) {
    die(`The REST API answered ${res.status} ${when}. ${(await res.text()).slice(0, 300)}`)
  }

  console.log(`   REST API answers ${res.status} ${when}`)
}

// --- 2. the schema ---------------------------------------------------------

async function dropV2() {
  step(2, 'Drop the schema and forget its migrations')

  const before = await sql(`
    select
      (select count(*) from information_schema.schemata where schema_name = 'v2') as schema_there,
      (select count(*) from supabase_migrations.schema_migrations
        where name like 'v2%') as ledger_rows,
      (select count(*) from public.jobs) as live_jobs,
      (select count(*) from public.agreements) as live_agreements;
  `)

  if (!before.ok) die(`Could not look at the database. ${JSON.stringify(before.body)}`)

  const state = before.body?.[0] || {}
  console.log(`   v2 schema present: ${state.schema_there}, ledger rows: ${state.ledger_rows}`)
  console.log(`   live jobs: ${state.live_jobs}, live agreements: ${state.live_agreements}`)

  if (Number(state.schema_there) === 0) {
    console.log('   already gone')
  } else if (DRY) {
    console.log('   would run: drop schema v2 cascade')
  } else {
    // Named explicitly rather than looked up, so this can only ever name v2.
    const dropped = await sql(`
      drop schema v2 cascade;
      delete from supabase_migrations.schema_migrations where name like 'v2%';
    `)

    if (!dropped.ok) die(`The drop failed. ${JSON.stringify(dropped.body)}`)
    console.log('   dropped')
  }

  if (DRY) return

  // The same counts, which must not have moved.
  const after = await sql(`
    select
      (select count(*) from information_schema.schemata where schema_name = 'v2') as schema_there,
      (select count(*) from supabase_migrations.schema_migrations
        where name like 'v2%') as ledger_rows,
      (select count(*) from public.jobs) as live_jobs,
      (select count(*) from public.agreements) as live_agreements;
  `)

  const now = after.body?.[0] || {}

  if (Number(now.schema_there) !== 0) die('The schema is still there.')
  if (Number(now.ledger_rows) !== 0) die('Its migration rows are still there.')
  if (Number(now.live_jobs) !== Number(state.live_jobs)) {
    die(`Jobs moved from ${state.live_jobs} to ${now.live_jobs}.`)
  }
  if (Number(now.live_agreements) !== Number(state.live_agreements)) {
    die(`Agreements moved from ${state.live_agreements} to ${now.live_agreements}.`)
  }

  console.log(`   gone, and live data unchanged: ${now.live_jobs} jobs, `
    + `${now.live_agreements} agreements`)
}

// --- 3. the function -------------------------------------------------------

async function deleteFunction() {
  step(3, 'Delete send-agreement-v2')

  const list = await call(`/v1/projects/${ref}/functions`)
  if (!list.ok) die(`Could not list the edge functions. ${JSON.stringify(list.body)}`)

  const slugs = (Array.isArray(list.body) ? list.body : []).map(f => f.slug)
  console.log(`   deployed now: ${slugs.join(', ')}`)

  if (!slugs.includes('send-agreement-v2')) {
    console.log('   not deployed, so there is nothing to delete')
    return
  }

  // Everything that is not the one being deleted has to come back. Taken from
  // what is actually deployed rather than from a list written here, because a
  // hardcoded list goes stale the moment somebody ships a function: the first
  // dry run of this script found signed-addresses, which had been deployed
  // that week and was nowhere in the four names this used to check.
  const survivors = slugs.filter(s => s !== 'send-agreement-v2')

  if (DRY) {
    console.log(`   would delete send-agreement-v2 and leave ${survivors.length} others: `
      + survivors.join(', '))
    return
  }

  const gone = await call(`/v1/projects/${ref}/functions/send-agreement-v2`, { method: 'DELETE' })
  if (!gone.ok) die(`Could not delete it. ${JSON.stringify(gone.body)}`)

  const after = await call(`/v1/projects/${ref}/functions`)
  const left = (Array.isArray(after.body) ? after.body : []).map(f => f.slug)

  if (left.includes('send-agreement-v2')) die('It is still deployed.')

  // A delete that took another function with it would take the live document
  // pipeline down, so every one that was there before must still be there.
  for (const needed of survivors) {
    if (!left.includes(needed)) die(`${needed} is missing. It must still be deployed.`)
  }

  console.log(`   deleted, and all ${survivors.length} others remain: ${left.join(', ')}`)
}

// ---------------------------------------------------------------------------

const projects = await call('/v1/projects')
if (!projects.ok) die(`The token was refused. ${JSON.stringify(projects.body)}`)

const mine = (Array.isArray(projects.body) ? projects.body : []).find(p => p.id === ref)
if (!mine) {
  die(`This token cannot see ${ref}. It belongs to another account, which is the `
    + 'fault that took the edge deploys down for thirteen days in October.')
}

console.log(`${DRY ? 'Dry run against' : 'Removing the v2 partition from'} ${mine.name} (${ref})`)

await unexposeV2()
if (!DRY) await restStillWorks('after the schema list changed')

await dropV2()
if (!DRY) await restStillWorks('after the drop')

await deleteFunction()

console.log(`\n${DRY ? 'Nothing was changed.' : 'The partition is gone.'}\n`)
