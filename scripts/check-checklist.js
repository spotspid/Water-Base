import {
  CHECKLIST_ITEMS, CHECKLIST_TOTAL, LINE_MATERIALS, LINE_SIZES, SITE_KEYS, SIZING_KEYS,
  YES, NO, UNKNOWN,
  checklistFromForm, checklistToForm, emptyChecklistForm, isAnswered, itemProblem,
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
  'receptacle_within_6ft', 'drain_distance_ft', 'main_line_size', 'main_line_material',
  'irrigation_lines', 'removing_old_equipment']) {
  check(`the checklist asks ${k}`, keys.includes(k))
}
check('ten asked, plus finish, RO type and payment type, is thirteen', CHECKLIST_TOTAL === 13)
check('irrigation allows unknown', CHECKLIST_ITEMS.find(i => i.key === 'irrigation_lines').kind === 'yesnounknown')

// --- the three that capture what the installer bills against ------------------
//
// A drain was a yes or a no, which said nothing about a forty foot run that
// costs per foot beyond twenty five. Power was a yes about the house rather
// than about the six feet that matter. Both now hold the number.

check('drain distance is a count, not a yes or no',
  CHECKLIST_ITEMS.find(i => i.key === 'drain_distance_ft').kind === 'count')
check('and its label says the unit is feet',
  CHECKLIST_ITEMS.find(i => i.key === 'drain_distance_ft').label.includes('feet'))
check('the receptacle question names the six feet',
  CHECKLIST_ITEMS.find(i => i.key === 'receptacle_within_6ft').label.includes('6 feet'))
check('the old drain and power keys are gone, not left beside the new ones',
  !keys.includes('drain_at_intake') && !keys.includes('power_at_intake'))
check('main line size offers a half, a three quarter and a one inch',
  LINE_SIZES.map(([v]) => v).join() === 'half,three_quarter,one')
check('and reads as inches on screen',
  LINE_SIZES.map(([, l]) => l).join() === '1/2 inch,3/4 inch,1 inch')
check('main line material offers all five',
  LINE_MATERIALS.map(([v]) => v).join() === 'pex,cpvc,pvc,copper,galvanized')
check('both are choices with their options attached',
  ['main_line_size', 'main_line_material'].every(k => {
    const i = CHECKLIST_ITEMS.find(x => x.key === k)
    return i.kind === 'choice' && Array.isArray(i.options) && i.options.length > 0
  }))
check('a size that is not on the list is not stored',
  !('main_line_size' in checklistFromForm({ ...emptyChecklistForm(), main_line_size: 'two' })))
check('and reads back blank rather than throwing',
  checklistToForm({ main_line_material: 'lead' }).main_line_material === '')
check('a real choice stores and reads back',
  checklistFromForm({ ...emptyChecklistForm(), main_line_material: 'copper' }).main_line_material === 'copper'
  && checklistToForm({ main_line_material: 'copper' }).main_line_material === 'copper')
check('a drain distance of zero is an answer, not a blank',
  isAnswered({ ...emptyChecklistForm(), drain_distance_ft: '0' }, 'drain_distance_ft'))
check('a fractional drain distance goes amber with its own label',
  itemProblem({ ...emptyChecklistForm(), drain_distance_ft: '12.5' }, 'drain_distance_ft')
    === 'Drain distance from the install (feet) must be a whole number, zero or more.',
  itemProblem({ ...emptyChecklistForm(), drain_distance_ft: '12.5' }, 'drain_distance_ft'))
check('a negative drain distance is refused on save too',
  validateChecklist({ ...emptyChecklistForm(), drain_distance_ft: '-3' }) !== '')

// --- unanswered is not no ------------------------------------------------------

const blank = emptyChecklistForm()
const fullJob = { faucet_finish: 'Chrome', ro_type: 'Tank Style', payment_type: 'Zelle' }

check('a blank checklist on a job with every pick has ten unanswered',
  unansweredItems(blank, fullJob).length === 10)
check('and a job with no picks adds three more',
  unansweredItems(blank, {}).length === 13)
check('the three from the job are marked as living on the job',
  unansweredItems(blank, {}).filter(i => i.onJob).map(i => i.key).join() === 'faucet_finish,ro_type,payment_type')

check('no is an answer', isAnswered({ ...blank, receptacle_within_6ft: NO }, 'receptacle_within_6ft'))
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
  space_confirmed: YES, receptacle_within_6ft: NO, drain_distance_ft: '40',
  main_line_size: 'three_quarter', main_line_material: 'copper',
  irrigation_lines: UNKNOWN, removing_old_equipment: YES, old_equipment_upcharge: '250',
}
const stored = checklistFromForm(answered)

check('counts are stored as numbers', stored.people_in_home === 4 && stored.bathrooms === 2)
check('text is trimmed', stored.shutoff_location === 'Basement, north wall')
check('choices are stored as words', stored.receptacle_within_6ft === NO && stored.irrigation_lines === UNKNOWN)
check('the drain distance is stored as a number', stored.drain_distance_ft === 40)
check('the main line is stored as its value, not its label',
  stored.main_line_size === 'three_quarter' && stored.main_line_material === 'copper')
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
  checklistToForm({ people_in_home: 'lots', receptacle_within_6ft: 'maybe', bathrooms: -2 }).people_in_home === ''
  && checklistToForm({ receptacle_within_6ft: 'maybe' }).receptacle_within_6ft === '')
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
check('site is shutoff, receptacle, drain distance, the main line, irrigation and old equipment',
  SITE_KEYS.join() === 'shutoff_location,receptacle_within_6ft,drain_distance_ft,main_line_size,'
    + 'main_line_material,irrigation_lines,removing_old_equipment',
  SITE_KEYS.join())
const halves = [...SIZING_KEYS, ...SITE_KEYS]
check('every checklist question is in one half or the other',
  CHECKLIST_ITEMS.every(i => halves.includes(i.key)),
  CHECKLIST_ITEMS.filter(i => !halves.includes(i.key)).map(i => i.key).join())
check('and no question is in both', new Set(halves).size === halves.length)
check('and neither half names a question that does not exist',
  halves.every(k => CHECKLIST_ITEMS.some(i => i.key === k)))

// --- an invalid value is amber as it is typed, not only on save ---------------
//
// It used to count as answered until the save refused it, so the box read fine
// and the section said "All 3 answered" over 2.5 bathrooms. itemProblem is the
// one rule both the screen and the save use.

check('a fractional count is not answered', !isAnswered({ ...blank, bathrooms: '2.5' }, 'bathrooms'))
check('and names the problem in the save sentence',
  itemProblem({ ...blank, bathrooms: '2.5' }, 'bathrooms') === 'Bathrooms must be a whole number, zero or more.')
check('a negative count is not answered', !isAnswered({ ...blank, people_in_home: '-1' }, 'people_in_home'))
check('a valid count has no problem', itemProblem({ ...blank, people_in_home: '4' }, 'people_in_home') === '')
check('a blank has no problem, only a gap', itemProblem(blank, 'bathrooms') === '')
check('a negative upcharge makes old equipment unanswered',
  !isAnswered({ ...blank, removing_old_equipment: YES, old_equipment_upcharge: '-5' }, 'removing_old_equipment'))
check('and reports against old equipment',
  itemProblem({ ...blank, removing_old_equipment: YES, old_equipment_upcharge: '-5' }, 'removing_old_equipment')
    === 'The old equipment upcharge must be zero or more.')
check('an invalid value counts as a gap, not an answer',
  unansweredItems({ ...answered, bathrooms: '2.5' }, fullJob).map(i => i.key).join() === 'bathrooms')
check('the save still refuses with the same sentence the box shows',
  validateChecklist({ ...blank, bathrooms: '2.5' }) === itemProblem({ ...blank, bathrooms: '2.5' }, 'bathrooms'))
check('and reports the first bad box in screen order',
  validateChecklist({ ...blank, people_in_home: '-1', bathrooms: '2.5' }).startsWith('People in home'))

// --- Save quote and Save and send quote ---------------------------------------
//
// Only the send button needs the email, and only a Quoted job can be sent.
// Save quote never sends, so it needs neither.

const quoteNoEmail = { ...baseJob, status: 'quoted', customer_email: '' }
check('Save quote saves a quote with no email', validateNewJob(quoteNoEmail) === '')
check('Save and send quote refuses without the email',
  validateNewJob(quoteNoEmail, { sending: true }) === 'A quote is sent by email, so the customer email is required.')
check('and sends once the email is there',
  validateNewJob({ ...quoteNoEmail, customer_email: 'a@b.co' }, { sending: true }) === '')
check('a job that is not Quoted cannot be sent as a quote',
  validateNewJob({ ...baseJob, status: 'sold', payment_type: 'Cash', faucet_finish: 'Chrome', ro_type: 'Tank Style',
    customer_email: 'a@b.co' }, { sending: true }).startsWith('Only a quote can be sent'))
check('the old quoteMode option no longer changes anything',
  validateNewJob(quoteNoEmail, { quoteMode: true }) === '')

console.log(failed === 0
  ? '\nAll checklist checks passed.'
  : `\n${failed} checklist check(s) failed.`)

process.exit(failed === 0 ? 0 : 1)
