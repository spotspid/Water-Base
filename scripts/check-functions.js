// Parses every edge function before it can be deployed.
//
// A syntax error or a duplicate binding in a Deno function is invisible until
// it is live, where it surfaces as BOOT_ERROR on the first real request and
// takes the whole function down. This repo has already lost a deploy to a
// variable named twice in one scope, which no amount of reading catches
// reliably and a parser catches instantly.
//
// Uses rolldown, which Vite already ships, so this adds no dependency. It is a
// parse and a module resolve, not a type check: jsr, npm and https imports are
// left external because they are Deno's to fetch, not ours.
//
// Run with: npm run check:functions

import { readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { rolldown } from 'rolldown'

const ROOT = resolve(import.meta.dirname, '..')
const DIR = join(ROOT, 'supabase', 'functions')

const isRemote = id =>
  id.startsWith('jsr:') || id.startsWith('npm:') || id.startsWith('node:')
  || id.startsWith('https://') || id.startsWith('http://')

let failed = 0
let checked = 0

const slugs = existsSync(DIR)
  ? readdirSync(DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name)
  : []

for (const slug of slugs) {
  const entry = join(DIR, slug, 'index.ts')

  if (!existsSync(entry)) {
    console.log(`  SKIP  ${slug}  no index.ts`)
    continue
  }

  checked += 1

  try {
    const bundle = await rolldown({
      input: entry,
      platform: 'neutral',
      external: isRemote,
      // Deno writes './messages.ts' with the extension. Without this rolldown
      // looks for './messages.ts.ts' and reports a missing module that is
      // sitting right there.
      resolve: { extensions: ['.ts', '.js', '.mjs'] },
      onwarn: () => {},
    })

    await bundle.generate({ format: 'esm' })
    await bundle.close()

    console.log(`  PASS  ${slug}`)
  } catch (caught) {
    failed += 1
    console.log(`  FAIL  ${slug}`)
    console.log(`          ${(caught?.message || String(caught)).split('\n').slice(0, 6).join('\n          ')}`)
  }
}

console.log('')

if (checked === 0) {
  console.log('No edge functions to check.')
} else if (failed > 0) {
  console.error(`${failed} of ${checked} edge function(s) will not parse. Fix before deploying.`)
  process.exit(1)
} else {
  console.log(`All ${checked} edge functions parse.`)
}
