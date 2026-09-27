import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Which modals can be dismissed by clicking beside them.
//
// The backdrop closing a modal is right for something being read and wrong for
// something being worked. The job drawer saves as you type, and the way to
// finish typing in a box is to click somewhere else; somewhere else was the
// backdrop, so the drawer closed and left the reader on the jobs list, a page
// away from wherever they had opened the job from. They read that as the app
// throwing them at the Operations tab, which is exactly what it looked like.
//
// Run with: npm run check:modals

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const DIR = resolve(import.meta.dirname, '..', 'src', 'components')

// Anything holding typed work or saving as it goes. A click beside these is an
// accident, not an instruction.
const HOLDS_WORK = [
  'JobDetailModal.jsx',
  'JobEditModal.jsx',
  'ScheduleJobModal.jsx',
]

const modal = readFileSync(resolve(DIR, 'Modal.jsx'), 'utf8')

check('the backdrop is opt out rather than always on',
  /dismissOnBackdrop = true/.test(modal))
check('and the handler is dropped entirely when it is off, not merely ignored',
  /onClick=\{dismissOnBackdrop \? onClose : undefined\}/.test(modal))
check('escape still closes everything, because it is a deliberate press',
  /e\.key === 'Escape'/.test(modal))
check('and the close button is always there',
  /className="modal-close"/.test(modal))

for (const file of HOLDS_WORK) {
  const source = readFileSync(resolve(DIR, file), 'utf8')
  check(`${file} cannot be dismissed by clicking beside it`,
    /dismissOnBackdrop=\{false\}/.test(source))
}

// Everything else keeps the old behaviour on purpose: a report, a history, a
// short form somebody opened by accident should close the way it always has.
const others = readdirSync(DIR)
  .filter(f => f.endsWith('.jsx') && !HOLDS_WORK.includes(f) && f !== 'Modal.jsx')
  .filter(f => /<Modal/.test(readFileSync(resolve(DIR, f), 'utf8')))

check('the rest still close on a click beside them', others.length > 0,
  `${others.length} modals left as they were`)
check('and none of them opted out by accident',
  others.every(f => !/dismissOnBackdrop/.test(readFileSync(resolve(DIR, f), 'utf8'))))

// --- nothing inside a working surface navigates away ------------------------
//
// A plain anchor is a full page load, which throws the whole app away along
// with whatever is open. The job drawer had one, to the schedule, written as
// an <a href> and sitting directly above the crew boxes: clicking near it left
// the drawer and landed on the Operations tab, which is exactly how it was
// reported.

for (const file of HOLDS_WORK) {
  const source = readFileSync(resolve(DIR, file), 'utf8')
  check(`${file} has no plain anchor to another page`,
    !/<a\s[^>]*href="\//.test(source),
    (source.match(/<a\s[^>]*href="\/[^"]*"/) || [''])[0])
}

const fields = readFileSync(resolve(DIR, 'JobDetailFields.jsx'), 'utf8')
check('a link out of a form opens in a new tab rather than taking the form with it',
  /to="\/settings"[\s\S]{0,160}target="_blank"/.test(fields))

console.log(failed === 0 ? '\nAll modal checks passed.' : `\n${failed} modal check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
