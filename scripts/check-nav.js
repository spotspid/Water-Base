import { createServer } from 'vite'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

// Opens every menu in the top bar with real React and fails if any item has
// no icon, if any menu throws, or if a menu renders fewer items than its group
// lists.
//
// Why this exists: a path renamed in navigation.js without its entry in the
// icon map rendered an undefined component, and opening Stock or Setup
// crashed the whole page with React error #130. A build cannot see that,
// because the menu only renders when someone opens it. NavMenu now draws a
// fallback icon rather than crashing, and this check makes sure the fallback
// is never what ships.
//
// Runs before every build (prebuild) and in npm run check. No database and no
// browser: navGroups.js and NavMenu.jsx import neither.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const warnings = []
const originalWarn = console.warn
console.warn = (...args) => { warnings.push(args.join(' ')) }

let server
try {
  server = await createServer({
    root: process.cwd(),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    ssr: { external: ['react', 'react-dom', 'react-router-dom'] },
  })

  const { NAV_GROUPS } = await server.ssrLoadModule('/src/components/navGroups.js')
  const NavMenu = (await server.ssrLoadModule('/src/components/NavMenu.jsx')).default
  const noop = () => {}

  check('the nav has groups', Array.isArray(NAV_GROUPS) && NAV_GROUPS.length > 0, NAV_GROUPS?.length)

  for (const group of NAV_GROUPS) {
    const missing = group.items.filter(item => typeof item.Icon !== 'function').map(item => item.to)
    check(`${group.label}: every item has an icon`, missing.length === 0, missing.join(' '))

    try {
      const html = renderToString(
        React.createElement(MemoryRouter, null,
          React.createElement(NavMenu, {
            group, open: true, current: false,
            onOpen: noop, onClose: noop, onToggle: noop, onHover: noop,
          })),
      )
      const items = (html.match(/role="menuitem"/g) || []).length
      check(`${group.label}: opens and lists all ${group.items.length} items`, items === group.items.length, items)
    } catch (caught) {
      check(`${group.label}: opens without crashing`, false, String(caught?.message || caught).split('\n')[0])
    }
  }
} catch (caught) {
  check('the nav modules load', false, String(caught?.message || caught).split('\n')[0])
} finally {
  if (server) await server.close()
  console.warn = originalWarn
}

check('no menu fell back to the placeholder icon', warnings.length === 0, warnings.join(' | '))

console.log(failed === 0
  ? '\nAll nav checks passed.\n'
  : `\n${failed} ${failed === 1 ? 'check' : 'checks'} failed.\n`)

process.exit(failed === 0 ? 0 : 1)
