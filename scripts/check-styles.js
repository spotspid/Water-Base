// Catches the Vite CSS split problem: a class defined in one route's
// stylesheet and used on another route, where it renders bare.
//
// Vite emits one CSS file per lazily loaded route. A class only reaches the
// browser on the routes whose chunk includes the stylesheet that defines it.
// So a shared component that borrows a class from Inventory.css looks right on
// /inventory and unstyled everywhere else, and nothing errors: the markup is
// valid, the rule is simply absent.
//
// Nothing here parses CSS or JS properly. It walks the import graph from each
// route entry, collects the classes the reachable modules use and the classes
// the reachable stylesheets define, and reports the difference. That is enough
// to catch the real fault, which is a class living in the wrong file.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = resolve(ROOT, 'src')

// Loaded by main.jsx before any route, so these are on every page.
const GLOBAL = ['src/index.css', 'src/App.css']

// Route entries. Login and AuthCallback are reachable without the shell, the
// rest sit behind it, and App.jsx pulls in the shell for all of them.
const ROUTES = [
  ['/login', 'src/pages/Login.jsx'],
  ['/auth/callback', 'src/pages/AuthCallback.jsx'],
  ['/dashboard', 'src/pages/Dashboard.jsx'],
  ['/jobs', 'src/pages/Jobs.jsx'],
  ['/jobs/new', 'src/pages/NewJob.jsx'],
  ['/schedule', 'src/pages/Schedule.jsx'],
  ['/inventory', 'src/pages/Inventory.jsx'],
  ['/orders', 'src/pages/Orders.jsx'],
  ['/templates', 'src/pages/Templates.jsx'],
  ['/expenses', 'src/pages/Expenses.jsx'],
  ['/pnl', 'src/pages/PnL.jsx'],
  ['/settings', 'src/pages/Settings.jsx'],
]

// Every protected route renders inside the shell, so whatever the shell uses
// is in play on all of them.
const SHELL = ['src/components/AppShell.jsx', 'src/components/RouteBoundary.jsx']

const IMPORT = /(?:^|\n)\s*import\s+(?:[^'"]*?from\s*)?['"](\.[^'"]+)['"]/g
const CLASSNAME = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g
const STRING = /['"]([^'"]*)['"]/g
const SELECTOR = /\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g

// A whole template literal, and one `${...}` hole inside it. Holes are matched
// without nesting, which is all this codebase uses and all a class expression
// should ever need.
const TEMPLATE = /`[^`]*`/g
const HOLE = /\$\{[^{}]*\}/g

// Strings inside a className expression that are not class names. A ternary
// picking a class by state reads `mode === 'week' ? 'sch-on' : 'sch-off'`, and
// only the last two are classes. Without this the checker reports every state
// value in the app as an unstyled class, which buries the real finding.
const NOT_A_CLASS = [
  /(?:===|!==|==|!=)\s*(['"`])[^'"`]*\1/g,
  /(['"`])[^'"`]*\1\s*(?:===|!==|==|!=)/g,
  /\.(?:includes|startsWith|endsWith|indexOf|match|split|localeCompare)\s*\(\s*(['"`])[^'"`]*\1/g,
]

function read(file) {
  try { return readFileSync(file, 'utf8') } catch { return '' }
}

function resolveImport(from, spec) {
  const base = resolve(dirname(from), spec)
  const tries = [base, `${base}.js`, `${base}.jsx`, `${base}/index.js`, `${base}/index.jsx`]
  return tries.find(existsSync) || null
}

// Everything reachable from an entry, stylesheets included.
function walk(entries) {
  const seen = new Set()
  const queue = entries.map(e => resolve(ROOT, e))

  while (queue.length) {
    const file = queue.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    if (!/\.(js|jsx)$/.test(file)) continue

    const body = read(file)
    for (const m of body.matchAll(IMPORT)) {
      const next = resolveImport(file, m[1])
      if (next && next.startsWith(SRC)) queue.push(next)
    }
  }

  return seen
}

// Class names a module puts in the DOM. Template literals and ternaries are
// flattened to every string they contain, which over-collects rather than
// under-collects, and over-collecting is the safe direction here.
function classesUsed(file) {
  const out = new Set()
  const body = read(file)

  for (const m of body.matchAll(CLASSNAME)) {
    const literal = m[1] ?? m[2]
    if (literal !== undefined) {
      for (const c of literal.split(/\s+/)) if (c) out.add(c)
      continue
    }
    let expr = m[3] || ''

    // Template literals carry classes in two places at once, and both count:
    //
    //   `nav-trigger${open ? ' nav-trigger-open' : ''}`
    //
    // "nav-trigger" is the static text and "nav-trigger-open" is inside the
    // hole. Reading the literal as one string finds neither and reports the
    // whole thing, braces and all, as a missing class.
    for (const tpl of expr.match(TEMPLATE) || []) {
      const inner = tpl.slice(1, -1)

      // the text between the holes
      for (const chunk of inner.split(HOLE)) {
        for (const c of chunk.split(/\s+/)) if (c) out.add(c)
      }

      // and the strings inside them, minus anything being compared against
      for (const hole of inner.match(HOLE) || []) {
        let body = hole
        for (const pattern of NOT_A_CLASS) body = body.replace(pattern, ' ')
        for (const s of body.matchAll(STRING)) {
          for (const c of s[1].split(/\s+/)) if (c) out.add(c)
        }
      }
    }

    expr = expr.replace(TEMPLATE, ' ')
    for (const pattern of NOT_A_CLASS) expr = expr.replace(pattern, ' ')

    for (const s of expr.matchAll(STRING)) {
      for (const c of s[1].split(/\s+/)) if (c) out.add(c)
    }
  }

  return out
}

function classesDefined(file) {
  const out = new Set()
  // strip comments so a class name mentioned in prose is not counted
  const body = read(file).replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of body.matchAll(SELECTOR)) out.add(m[1])
  return out
}

let failures = 0
const perRoute = []

for (const [route, entry] of ROUTES) {
  const shellToo = entry.includes('Login') || entry.includes('AuthCallback') ? [] : SHELL
  const reachable = walk([entry, ...shellToo, ...GLOBAL])

  const defined = new Set()
  for (const file of reachable) {
    if (!file.endsWith('.css')) continue
    for (const c of classesDefined(file)) defined.add(c)
  }

  const missing = new Map()
  for (const file of reachable) {
    if (!/\.jsx$/.test(file)) continue
    for (const c of classesUsed(file)) {
      if (defined.has(c)) continue
      const where = relative(ROOT, file).replace(/\\/g, '/')
      if (!missing.has(c)) missing.set(c, new Set())
      missing.get(c).add(where)
    }
  }

  perRoute.push([route, missing])
  failures += missing.size
}

for (const [route, missing] of perRoute) {
  if (missing.size === 0) {
    console.log(`  PASS  ${route}`)
    continue
  }
  console.log(`  FAIL  ${route}  ${missing.size} class(es) with no rule on this route`)
  for (const [cls, files] of [...missing].sort()) {
    console.log(`          .${cls}  used by ${[...files].join(', ')}`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} unstyled class use(s). Move the rule into src/index.css `
    + 'if it is shared, or into the stylesheet of every route that uses it.')
  process.exit(1)
}

console.log('\nAll style checks passed.')
