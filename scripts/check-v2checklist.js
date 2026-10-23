import {
  ITEMS, NO, NOT_SURE, SECTIONS, TYPICAL, YES,
  answer, applyBulk, emptyChecklist, isAnswered, noteApplies, toStored,
} from '../src/lib/v2Checklist.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? `  ${detail}` : ''))
  if (!ok) failed++
}

// --- the sections cover the questions ----------------------------------------

const grouped = SECTIONS.flatMap(s => s.keys)
const all = ITEMS.map(i => i.key)

check('every question is in a section', all.every(k => grouped.includes(k)),
  all.filter(k => !grouped.includes(k)).join(', '))
check('and none is in two', grouped.length === new Set(grouped).size)

// A bulk action has to be true for what it covers. All clear may only touch
// questions that answer yes or no; a blanket yes on a measurement would be
// inventing one.
for (const section of SECTIONS.filter(s => s.bulk === 'yes')) {
  const kinds = section.keys.map(k => ITEMS.find(i => i.key === k).kind)
  check(`${section.title} only clears yes or no questions`,
    kinds.every(kind => kind === 'yesno'), kinds.join(', '))
}

for (const section of SECTIONS.filter(s => s.bulk === 'typical')) {
  check(`${section.title} has a default for every question it fills`,
    section.keys.every(k => TYPICAL[k] !== undefined), section.keys.join(', '))
}

// --- the buttons --------------------------------------------------------------

const checks = SECTIONS.find(s => s.id === 'checks')
const sizing = SECTIONS.find(s => s.id === 'sizing')

const cleared = applyBulk(emptyChecklist(), checks)
check('All clear answers every check', checks.keys.every(k => cleared[k] === YES))

// The one that matters: it must not overwrite somebody's answer.
const withNo = answer(emptyChecklist(), 'drain_in_reach', NO)
const afterBulk = applyBulk(withNo, checks)
check('All clear leaves a no alone', afterBulk.drain_in_reach === NO, afterBulk.drain_in_reach)
check('and still fills the rest', afterBulk.space_confirmed === YES)

const typical = applyBulk(emptyChecklist(), sizing)
check('Typical home fills two and two',
  typical.people_in_home === '2' && typical.bathrooms === '2')
check('and leaves a number somebody typed',
  applyBulk({ ...emptyChecklist(), people_in_home: '5' }, sizing).people_in_home === '5')

// --- the note -----------------------------------------------------------------

check('a note belongs to a check that came back no', noteApplies(withNo, 'drain_in_reach'))
check('and not to one that came back yes', !noteApplies(cleared, 'drain_in_reach'))
check('and never to a question that is not yes or no',
  !noteApplies({ ...emptyChecklist(), shutoff_location: NO }, 'shutoff_location'))

const noted = { ...withNo, drain_in_reach_note: 'Twenty five feet to the stack' }
check('a note is stored with its answer',
  toStored(noted).drain_in_reach_note === 'Twenty five feet to the stack')

// Changing the answer away from no drops the note, so a document can never
// print a problem under an answer that says there is not one.
const changed = answer(noted, 'drain_in_reach', YES)
check('changing the answer to yes drops the note', changed.drain_in_reach_note === '')
check('and nothing of it is stored', toStored(changed).drain_in_reach_note === undefined)

// --- what gets stored ---------------------------------------------------------

check('a blank question is not stored at all',
  Object.keys(toStored(emptyChecklist())).length === 0,
  JSON.stringify(toStored(emptyChecklist())))
check('Not sure yet is stored as an answer, because it is one',
  toStored(answer(emptyChecklist(), 'shutoff_location', NOT_SURE)).shutoff_location === NOT_SURE)
check('an answered question is stored',
  isAnswered(cleared, 'irrigation_lines') && toStored(cleared).irrigation_lines === YES)

// Drain distance used to be a number typed on every quote.
check('the drain is a yes or no now, not a measurement',
  ITEMS.find(i => i.key === 'drain_in_reach').kind === 'yesno')
// "Receptacle within 6 feet" is allowed to say feet: it is a yes or no about a
// distance, not a box to type one into. What must not come back is a question
// that makes somebody measure.
check('and nothing makes somebody measure anything',
  !ITEMS.some(i => i.kind === 'count' && /distance|feet|length/i.test(i.label)),
  ITEMS.filter(i => i.kind === 'count').map(i => i.label).join(', '))

console.log(failed === 0 ? '\nAll v2 checklist checks passed.' : `\n${failed} failed.`)
process.exitCode = failed === 0 ? 0 : 1
