// Catches an ambiguous PostgREST embed before it reaches production.
//
// A select like `jobs(customer_name)` on inventory_transactions asks
// PostgREST to pick the foreign key between the two tables. While there was
// one, it did. The day a second one arrived, warranty_job_id beside job_id,
// every such embed became "more than one relationship was found" and the
// dashboard went down. Nothing in the repo had ever run the query, and a
// string inside a page is not something a build or a lint can judge.
//
// This reads the migrations for every pair of tables joined by more than one
// foreign key, then reads every select string in the app and the edge
// functions and refuses an embed to such a table that does not name its key
// with the `!constraint_name` hint. It also refuses a hint that names a key
// the migrations do not define, so a typo fails here rather than at runtime.
//
// Nothing here parses SQL or JavaScript properly. It reads lines, which is
// enough because the migrations are written one clause per line and the
// column lists are string constants. If either stops being true, the check
// says so rather than passing quietly.
//
// Run with: npm run check:embeds

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const CODE_DIRS = [join(ROOT, 'src'), join(ROOT, 'supabase', 'functions')]

let failed = 0
let checked = 0

function fail(message) {
  console.log(`  FAIL  ${message}`)
  failed += 1
}

// --- foreign keys, by source table and target table ------------------------

// fks[source][target] = [constraint names]
const fks = {}

function addFk(source, target, name) {
  if (!source || !target) return
  fks[source] ??= {}
  fks[source][target] ??= []
  if (!fks[source][target].includes(name)) fks[source][target].push(name)
}

for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
  const lines = readFileSync(join(MIGRATIONS, file), 'utf8').split(/\r?\n/)
  let table = ''
  let inCreate = false
  let pendingColumn = ''

  for (const raw of lines) {
    const line = raw.replace(/--.*$/, '').trim()
    if (!line) continue

    const create = line.match(/^create table (?:if not exists )?public\.(\w+)/i)
    if (create) { table = create[1]; inCreate = true; continue }

    const alter = line.match(/^alter table (?:only )?public\.(\w+)/i)
    if (alter) { table = alter[1]; inCreate = false; continue }

    if (inCreate && line.startsWith(')')) { inCreate = false; continue }

    // add column if not exists x uuid references public.y(id)
    // or, inside create table:   x uuid references public.y(id)
    const inline = line.match(/^(?:add column (?:if not exists )?)?(\w+)\s+\w+.*\breferences public\.(\w+)/i)
    if (inline && table) {
      addFk(table, inline[2], `${table}_${inline[1]}_fkey`)
      continue
    }

    // add constraint name foreign key (col) references public.y(id), which
    // is sometimes split across two lines
    const named = line.match(/^add constraint (\w+)$/i) || line.match(/^add constraint (\w+)\s+foreign key/i)
    if (named) pendingColumn = named[1]
    const target = line.match(/\breferences public\.(\w+)/i)
    if (pendingColumn && target && table) {
      addFk(table, target[1], pendingColumn)
      pendingColumn = ''
    }
  }
}

const doubled = []
for (const [source, targets] of Object.entries(fks)) {
  for (const [target, names] of Object.entries(targets)) {
    if (names.length > 1) doubled.push({ source, target, names })
  }
}

if (doubled.length === 0) {
  fail('no table pair with two foreign keys was found in the migrations, which is not '
    + 'true of this schema; the migration parser needs looking at')
}

// --- the select strings -----------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(js|jsx|ts)$/.test(name)) out.push(full)
  }
  return out
}

// `.select(` followed by either a string literal or an identifier
const SELECT = /\.select\(\s*(?:(['"`])([\s\S]*?)\1|([A-Za-z_]\w*))\s*[,)]/g
// the nearest `.from('table')` before a select
const FROM = /\.from\(\s*['"`](\w+)['"`]\s*\)/g
// an embed: optional alias, table, optional !hint, then (
const EMBED = /(?:(\w+):)?(\w+)(?:!(\w+))?\(/g

// Every uppercase string constant in the scanned files, resolved to one
// string. A column list is written as literals joined by +, one per line, and
// may be imported from another file, so they are all collected first and
// looked up by name. The value runs until the next line that starts at the
// left margin, which is where the next declaration begins.
const CONSTANTS = new Map()
// The lookahead ends at the next left margin line or the end of the file.
// A plain `$` would end at the first line break under the m flag and cut a
// multi line constant off after its first literal, which is exactly how this
// check once passed the query it exists to catch.
const CONSTANT = /^(?:export )?const ([A-Z][A-Z0-9_]*)\s*=\s*([\s\S]*?)(?=\n\S|(?![\s\S]))/gm

const files = CODE_DIRS.flatMap(dir => walk(dir))

for (const file of files) {
  for (const m of readFileSync(file, 'utf8').matchAll(CONSTANT)) {
    const parts = [...m[2].matchAll(/(['"`])([\s\S]*?)\1/g)].map(p => p[2])
    if (parts.length > 0) CONSTANTS.set(m[1], parts.join(''))
  }
}

for (const file of files) {
  {
    const body = readFileSync(file, 'utf8')
    const where = relative(ROOT, file).replace(/\\/g, '/')

    for (const sel of body.matchAll(SELECT)) {
      const columns = sel[2] ?? CONSTANTS.get(sel[3]) ?? null
      if (columns == null) {
        if (sel[3]) fail(`${where}: select(${sel[3]}) could not be resolved to a string`)
        continue
      }

      // the source table is the last .from() before this select
      let source = ''
      for (const f of body.slice(0, sel.index).matchAll(FROM)) source = f[1]
      if (!source) continue

      checked += 1

      for (const emb of columns.matchAll(EMBED)) {
        const [, , target, hint] = emb
        const names = fks[source]?.[target]

        if (hint && (!names || !names.includes(hint))) {
          fail(`${where}: ${source} embeds ${target}!${hint}, and no foreign key by that name `
            + `exists from ${source} to ${target}`)
          continue
        }

        if (names && names.length > 1 && !hint) {
          fail(`${where}: ${source} embeds ${target}(...) but ${source} has ${names.length} `
            + `foreign keys to ${target} (${names.join(', ')}); name one with `
            + `${target}!${names[0]}(...) or PostgREST refuses the query`)
        }
      }
    }
  }
}

for (const d of doubled) {
  console.log(`  PASS  ${d.source} -> ${d.target} has ${d.names.length} keys and every embed names one`)
}

console.log('')
if (failed > 0) {
  console.error(`${failed} embed check(s) failed across ${checked} select(s).`)
  process.exit(1)
}
console.log(`All embed checks passed across ${checked} select(s).`)
