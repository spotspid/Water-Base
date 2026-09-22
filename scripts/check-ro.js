import { FAUCET_NA, NO_RO, applyRoPick, faucetChoices, roPickProblem } from '../src/lib/roPicks.js'
import { validateNewJob } from '../src/lib/newJobForm.js'

// Checks No RO and the faucet finish that goes with it.
//
// The rule: N/A is the faucet for a job with no RO and for nothing else. A job
// with an RO and a faucet of N/A would send an RO out with no faucet, and
// nobody would find out until the box was opened in the customer's kitchen.
//
// The database holds the same rule in the jobs_ro_picks trigger, and its proof
// block in 20260922000000_no_ro.sql covers the parts the RO takes with it.
// This covers the form, which keeps the two picks in step as they are made.
//
// Run with: npm run check:ro

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const FINISHES = ['Chrome', 'Brushed Nickel', 'Matte Black', 'Brushed Gold', FAUCET_NA]
const base = { ro_type: 'Tank Style', faucet_finish: 'Chrome', payment_type: 'Zelle' }

// --- picking keeps the two in step --------------------------------------------

const noRo = applyRoPick(base, 'ro_type', NO_RO)
check('picking No RO sets the faucet to N/A', noRo.faucet_finish === FAUCET_NA)
check('in the same step, so the form is never briefly wrong', roPickProblem(noRo) === '')

const back = applyRoPick(noRo, 'ro_type', 'Tankless')
check('bringing the RO back clears N/A to blank', back.faucet_finish === '')
check('rather than keeping a finish that means no faucet', back.faucet_finish !== FAUCET_NA)
check('and a real finish is kept when the RO changes between types',
  applyRoPick(base, 'ro_type', 'Tankless').faucet_finish === 'Chrome')
check('other fields pass straight through',
  applyRoPick(base, 'city', 'Novi').city === 'Novi' && applyRoPick(base, 'city', 'Novi').faucet_finish === 'Chrome')
check('the form it was given is not changed', base.faucet_finish === 'Chrome' && base.ro_type === 'Tank Style')

// --- what the dropdown offers ------------------------------------------------

check('with No RO the only finish is N/A', faucetChoices(FINISHES, NO_RO).join() === FAUCET_NA)
check('with an RO, N/A is not offered', !faucetChoices(FINISHES, 'Tank Style').includes(FAUCET_NA))
check('and every real finish is', faucetChoices(FINISHES, 'Tank Style').length === 4)
check('with no RO type picked yet, N/A is not offered either', !faucetChoices(FINISHES, '').includes(FAUCET_NA))
check('a job holding a finish that has since been hidden still shows it',
  faucetChoices(FINISHES, 'Tankless', 'Oil-Rubbed Bronze').includes('Oil-Rubbed Bronze'))
check('but a job holding N/A with an RO is not handed N/A back',
  !faucetChoices(FINISHES, 'Tankless', FAUCET_NA).includes(FAUCET_NA))
check('no finishes loaded yet is an empty list, not a crash', faucetChoices(undefined, 'Tankless').length === 0)

// --- what is refused ---------------------------------------------------------

check('N/A with an RO is refused',
  roPickProblem({ ro_type: 'Tank Style', faucet_finish: FAUCET_NA }).startsWith('Faucet finish N/A is only'))
check('N/A with no RO type at all is refused',
  roPickProblem({ ro_type: '', faucet_finish: FAUCET_NA }) !== '')
check('No RO with a real finish is refused',
  roPickProblem({ ro_type: NO_RO, faucet_finish: 'Chrome' }) !== '')
check('the ordinary pairs are fine',
  roPickProblem(base) === '' && roPickProblem({ ro_type: NO_RO, faucet_finish: FAUCET_NA }) === '')
check('two blanks are fine: a quote may leave both open', roPickProblem({}) === '')
check('the words match the database trigger',
  roPickProblem({ ro_type: 'Tankless', faucet_finish: FAUCET_NA })
    === 'Faucet finish N/A is only for a job with no RO. Pick a finish, or set the RO type to No RO.')

// --- the New quote form -------------------------------------------------------

const quote = {
  customer_name: 'A', phone: '1', customer_email: '', address: 'x', city: 'Novi',
  system_template: 'Flagship Bundle', payment_type: 'Zelle', sale_price: '2999', deposit_amount: '899.70',
  payout_amount: '', installer_id: '', helper_id: '', scheduled_date: '', install_date: '', time_window: '',
}
check('a sold No RO job saves: N/A satisfies the faucet',
  validateNewJob({ ...quote, status: 'sold', ro_type: NO_RO, faucet_finish: FAUCET_NA }) === '',
  validateNewJob({ ...quote, status: 'sold', ro_type: NO_RO, faucet_finish: FAUCET_NA }))
check('a New quote with N/A and an RO is refused before it reaches the database',
  validateNewJob({ ...quote, status: 'quoted', ro_type: 'Tankless', faucet_finish: FAUCET_NA })
    .startsWith('Faucet finish N/A is only'))

console.log(failed === 0 ? '\nAll RO checks passed.' : `\n${failed} RO check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
