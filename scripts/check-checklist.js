import {
  CHECKLIST_ITEMS, CHECKLIST_TOTAL, SITE_KEYS, SIZING_KEYS, YES, NO, UNKNOWN,
  checklistFromForm, checklistToForm, emptyChecklistForm, isAnswered,
  unansweredItems, validateChecklist, workOrderSiteConditions, workOrderSiteLines,
} from '../src/lib/salesChecklist.js'
import * as printed from '../supabase/functions/send-agreement/siteConditions.ts'
import { validateNewJob } from '../src/lib/newJobForm.js'

// Checks the sales checklist from the Sept 17 call.
//
// The rule that matters most is that unanswered and no are different things.
// A blank "power at intake" means nobody asked, and it goes amber. A no is an
// answer. Mixing the two up is how an install discovers there is no outlet.
//
// The second is that the work order prints exactly what the app computes. The
// printed copy lives in the edge function and cannot import from src, so this
// loads both and compares them.
//
// Run with: npm run check:checklist

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// --- the items ---------------------------------------------------------------

const keys = CHECKLIST_ITEMS.map(i => i.key)
for (const k of ['people_in_home', 'bathrooms', 'shutoff_location', 'space_confirmed',
  'power_at_intake', 'drain_at_intake', 'irrigation_lines', 'removing_old_equipment']) {
  check(`the checklist asks ${k}`, keys.includes(k))
}
check('eight asked, plus finish, RO type and payment type, is eleven', CHECKLIST_TOTAL === 11)
check('irrigation allows unknown', CHECKLIST_ITEMS.find(i => i.key === 'irrigation_lines').kind === 'yesnounknown')

// --- unanswered is not no ------------------------------------------------------

const blank = emptyChecklistForm()
const fullJob = { faucet_finish: 'Chrome', ro_type: 'Tank Style', payment_type: 'Zelle' }

check('a blank checklist on a job with every pick has eight unanswered',
  unansweredItems(blank, fullJob).length === 8)
check('and a job with no picks adds three more',
  unansweredItems(blank, {}).length === 11)
check('the three from the job are marked as living on the job',
  unansweredItems(blank, {}).filter(i => i.onJob).map(i => i.key).join() === 'faucet_finish,ro_type,payment_type')

check('no is an answer', isAnswered({ ...blank, power_at_intake: NO }, 'power_at_intake'))
check('unknown is an answer for irrigation', isAnswered({ ...blank, irrigation_lines: UNKNOWN }, 'irrigation_lines'))
check('zero people is an answer, not a blank', isAnswered({ ...blank, people_in_home: '0' }, 'people_in_home'))
check('a yes to old equipment with no upcharge is still unanswered',
  !isAnswered({ ...blank, removing_old_equipment: YES }, 'removing_old_equipment'))
check('and answered once the upcharge is in',
  isAnswered({ ...blank, removing_old_equipment: YES, old_equipment_upcharge: '150' }, 'removing_old_equipment'))
check('a no to old equipment needs no upcharge',
  isAnswered({ ...blank, removing_old_equipment: NO }, 'removing_old_equipment'))

// --- validation refuses wrong values, never blanks -------------------------------

check('a blank checklist is valid', validateChecklist(blank) === '')
check('a negative head count is refused', validateChecklist({ ...blank, people_in_home: '-1' }) !== '')
check('a fractional bathroom count is refused', validateChecklist({ ...blank, bathrooms: '2.5' }) !== '')
check('a negative upcharge is refused',
  validateChecklist({ ...blank, removing_old_equipment: YES, old_equipment_upcharge: '-5' }) !== '')
check('an upcharge on a no is refused rather than silently dropped',
  validateChecklist({ ...blank, removing_old_equipment: NO, old_equipment_upcharge: '100' }) !== '')

// --- round trip ------------------------------------------------------------------

const answered = {
  ...blank,
  people_in_home: '4', bathrooms: '2', shutoff_location: '  Basement, north wall  ',
  space_confirmed: YES, power_at_intake: NO, drain_at_intake: YES,
  irrigation_lines: UNKNOWN, removing_old_equipment: YES, old_equipment_upcharge: '250',
}
const stored = checklistFromForm(answered)

check('counts are stored as numbers', stored.people_in_home === 4 && stored.bathrooms === 2)
check('text is trimmed', stored.shutoff_location === 'Basement, north wall')
check('choices are stored as words', stored.power_at_intake === NO && stored.irrigation_lines === UNKNOWN)
check('the upcharge is stored with a yes', stored.old_equipment_upcharge === 250)
check('blanks are left out rather than stored', !('bathrooms' in checklistFromForm(blank)))
check('an empty form stores an empty object', Object.keys(checklistFromForm(blank)).length === 0)
check('an upcharge is dropped when old equipment stays',
  !('old_equipment_upcharge' in checklistFromForm({ ...answered, removing_old_equipment: NO })))

const back = checklistToForm(stored)
check('a stored checklist reads back into the same form values',
  back.people_in_home === '4' && back.shutoff_location === 'Basement, north wall'
  && back.removing_old_equipment === YES && back.old_equipment_upcharge === '250')
check('rubbish in the row reads back blank rather than throwing',
  checklistToForm({ people_in_home: 'lots', power_at_intake: 'maybe', bathrooms: -2 }).people_in_home === ''
  && checklistToForm({ power_at_intake: 'maybe' }).power_at_intake === '')
check('a null row reads back blank', checklistToForm(null).shutoff_location === '')
check('an array row reads back blank', checklistToForm([1, 2]).bathrooms === '')

// --- what the work order prints --------------------------------------------------

check('shutoff and removal both print',
  workOrderSiteLines(stored).join(' | ') === 'Main water shutoff: Basement, north wall | Remove old equipment (upcharge $250.00)',
  workOrderSiteLines(stored).join(' | '))
check('a no prints that old equipment stays',
  workOrderSiteLines({ removing_old_equipment: NO }).join() === 'Old equipment stays')
check('a yes with no amount says the upcharge is not recorded',
  workOrderSiteLines({ removing_old_equipment: YES }).join() === 'Remove old equipment (upcharge not recorded)')
check('unanswered prints nothing', workOrderSiteLines({}).length === 0)
check('typed site conditions come first',
  workOrderSiteConditions('Dog in yard', stored).startsWith('Dog in yard\nMain water shutoff'))
check('nothing typed and nothing answered is empty, so the field still locks blank',
  workOrderSiteConditions('', {}) === '' && workOrderSiteConditions(null, null) === '')

// --- the printed copy agrees -------------------------------------------------------

const cases = [
  [null, null], ['', {}], ['Dog in yard', stored], ['  ', { shutoff_location: '   ' }],
  ['', { removing_old_equipment: YES }], ['', { removing_old_equipment: NO, old_equipment_upcharge: 9 }],
  ['Gate code 1234', { shutoff_location: 'Garage', removing_old_equipment: YES, old_equipment_upcharge: 1234.5 }],
  ['x', 'not an object'],
]
for (const [typed, s] of cases) {
  const app = workOrderSiteConditions(typed, s)
  const fn = printed.workOrderSiteConditions(typed, s)
  check(`the edge function prints what the app shows for ${JSON.stringify([typed, s])}`, app === fn,
    app === fn ? '' : `${JSON.stringify(app)} vs ${JSON.stringify(fn)}`)
}

// --- the form lets a quote leave the three job picks blank -------------------
//
// On a quote, finish, RO type and payment type are checklist items and may be
// unanswered. A sold job still needs them, because its parts do.

const baseJob = {
  customer_name: 'A', phone: '1', customer_email: '', address: 'x', city: 'Novi',
  system_template: 'Well Water Bundle', payment_type: '', faucet_finish: '', ro_type: '',
  sale_price: '3799', deposit_amount: '1139.70', payout_amount: '', installer_id: '',
  helper_id: '', scheduled_date: '', install_date: '', time_window: '',
}

check('a quote saves with finish, RO type and payment type unanswered',
  validateNewJob({ ...baseJob, status: 'quoted' }) === '',
  validateNewJob({ ...baseJob, status: 'quoted' }))
check('a sold job still needs a payment type',
  validateNewJob({ ...baseJob, status: 'sold' }) === 'Pick a payment type.')
check('a city typed with only spaces is refused',
  validateNewJob({ ...baseJob, status: 'quoted', city: '   ' }) === 'Enter a city.')
check('the build sheet message uses the one name for it',
  validateNewJob({ ...baseJob, status: 'quoted', system_template: '' }) === 'Pick a build sheet.')

// --- the New quote form splits the checklist around the system choice --------
//
// Sizing sits above the system, site below it. Every question has to land in
// exactly one half: an item in neither would vanish from the form without any
// error, and an item in both would be asked twice.

check('sizing is people, bathrooms and space',
  SIZING_KEYS.join() === 'people_in_home,bathrooms,space_confirmed')
check('site is shutoff, power, drain, irrigation and old equipment',
  SITE_KEYS.join() === 'shutoff_location,power_at_intake,drain_at_intake,irrigation_lines,removing_old_equipment')
const halves = [...SIZING_KEYS, ...SITE_KEYS]
check('every checklist question is in one half or the other',
  CHECKLIST_ITEMS.every(i => halves.includes(i.key)),
  CHECKLIST_ITEMS.filter(i => !halves.includes(i.key)).map(i => i.key).join())
check('and no question is in both', new Set(halves).size === halves.length)
check('and neither half names a question that does not exist',
  halves.every(k => CHECKLIST_ITEMS.some(i => i.key === k)))

console.log(failed === 0
  ? '\nAll checklist checks passed.'
  : `\n${failed} checklist check(s) failed.`)

process.exit(failed === 0 ? 0 : 1)
