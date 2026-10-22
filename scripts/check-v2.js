import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The one rule the rebuild cannot break.
//
// v2 is renamed over public at cutover:
//
//   alter schema public rename to archive_2026;
//   alter schema v2 rename to public;
//
// That works only while v2 stands alone. One foreign key, one view, one
// function body reaching into public and the two schemas can no longer be
// swapped, because half of v2 would then be pointing at a schema that has
// just been renamed out from under it.
//
// It is an easy rule to break by accident and an expensive one to discover
// late, so it is checked here rather than remembered. auth.users is the single
// allowed exception: it lives outside both schemas and is not renamed.
//
// This reads the migration files rather than the database, so it runs in CI
// with no credentials and fails a pull request before anything is applied.

const DIR = 'supabase/migrations'
const ALLOWED = new Set(['auth.users', 'auth.uid'])

// Comments are prose and routinely explain the cutover, which means saying the
// word public. String literals carry note text that has said "System
// Replacement v2." since September. Neither is code, so both come out before
// anything is matched: the first version of this check read them and blamed a
// migration from 16 September for a rule written five weeks later.
function statementsOf(sql) {
  const withoutComments = sql
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')

  return withoutComments.replace(/'(?:[^']|'')*'/g, "''")
}

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// Only the files that build v2. A migration that predates the rebuild is
// allowed to talk about public as much as it likes.
const files = readdirSync(DIR)
  .filter(name => name.endsWith('.sql'))
  .filter(name => {
    const statements = statementsOf(readFileSync(join(DIR, name), 'utf8'))
    return /\bv2\.[a-z_]+/i.test(statements) || /\bschema\s+v2\b/i.test(statements)
  })
  .sort()

console.log(`${files.length} migration(s) build v2\n`)

if (files.length === 0) {
  check('there is something to check', false, 'no migration builds v2')
}

for (const name of files) {
  const statements = statementsOf(readFileSync(join(DIR, name), 'utf8'))

  const hits = [...statements.matchAll(/\b(?:public|auth)\.[a-z_]+/gi)]
    .map(match => match[0].toLowerCase())
    .filter(ref => !ALLOWED.has(ref))

  check(`${name} does not reach into public`, hits.length === 0,
    hits.length === 0 ? '' : `found ${[...new Set(hits)].join(', ')}`)
}

// The second half of the rule: every table carries the tenant from the day it
// is created. Adding org_id later means revisiting every row to decide who
// owns it, on a live system, which is the thing the rebuild exists to avoid.
for (const name of files) {
  const sql = readFileSync(join(DIR, name), 'utf8')
  const tables = [...sql.matchAll(/create table if not exists v2\.([a-z_]+)\s*\(([\s\S]*?)\n\);/g)]

  for (const [, table, body] of tables) {
    // organizations is the tenant itself, and memberships points at it through
    // its own primary key, so neither carries a column naming one.
    if (table === 'organizations' || table === 'memberships') continue

    const tenanted = /\borg_id\b/.test(body)
    check(`v2.${table} carries org_id`, tenanted,
      tenanted ? '' : 'a table without a tenant cannot be shared safely')
  }
}

console.log(failed === 0
  ? '\nv2 stands alone and every table is tenanted.'
  : `\n${failed} v2 check(s) failed. The cutover rename would not work.`)

process.exitCode = failed === 0 ? 0 : 1
