import { IconFallback } from './NavIcons'

// An item with no icon gets a plain one and a console warning, once per path.
//
// Rendering an undefined component throws, and in a menu that took the whole
// page down (React error #130) when a path in navigation.js had no entry in
// the icon map in navGroups.js. check:nav fails the build on the same gap, so
// this is the second line, not the first.
//
// It lives in its own file rather than beside one of the menus because both
// the bar and the drawer draw the same items, and a second copy of the
// fallback is a second thing to keep in step.
const warnedMissingIcon = new Set()

export function iconFor(item) {
  if (item.Icon) return item.Icon
  if (!warnedMissingIcon.has(item.to)) {
    warnedMissingIcon.add(item.to)
    console.warn(`Nav item "${item.text}" (${item.to}) has no icon. Add it to the icon map in navGroups.js.`)
  }
  return IconFallback
}
