import { readFileSync } from 'node:fs'
import {
  hasSuggestion, payoutNote, payoutStanding, rateAmount, rateButtonLabel, rateLine, rateValue,
} from '../src/lib/installRates.js'

// The rate card, now that it sets something.
//
// It was a printed list beside a free text box for as long as there was one
// installer. With three, "the rate" is a different number per person, and the
// box has to say which one it is offering and where it came from, because the
// failure this replaces is a $1,600 payout on a job the card prices at $600
// with nobody able to say afterwards where the figure came from.
//
// The rates themselves live in install_rate_lines and installer_rates. What is
// tested here is the wording and the arithmetic around them, and that the
// suggestion is never written into the box on its own.
//
// Run with: npm run check:rates

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const OWN = {
  amount: 500,
  rate_key: 'softener_ro',
  rate_label: 'Softener plus brine tank, and RO install',
  source: 'installer',
  installer_name: 'Jay Woodward',
  reason: 'Jay Woodward is paid $500.00 for softener plus brine tank, and ro install.',
}

const CARD = {
  ...OWN,
  source: 'card',
  reason: 'The rate card pays $500.00 for softener plus brine tank, and ro install. '
    + 'Ash Miller has no rate of their own yet.',
  installer_name: 'Ash Miller',
}

const NONE = {
  amount: null,
  source: 'none',
  reason: 'The Custom sheet has no rate line, so the pay has to be typed.',
}

// --- is there anything to offer ---------------------------------------------

check('a rate from the installer is a suggestion', hasSuggestion(OWN))
check('so is one from the card', hasSuggestion(CARD))
check('a sheet with no rate line is not', !hasSuggestion(NONE))
check('and neither is nothing at all', !hasSuggestion(null) && !hasSuggestion({}))

// --- money -------------------------------------------------------------------

check('a rate prints in whole dollars', rateAmount({ amount: 500 }) === '$500')
check('and takes a bare number too', rateAmount(250) === '$250')
check('a per clause rides along', rateLine({ amount: 4, per: 'per foot' }) === '$4 per foot')
check('and is left out when there is none', rateLine({ amount: 50 }) === '$50')

// --- where a typed figure stands ---------------------------------------------

check('nothing typed leaves the rate as the offer', payoutStanding('', OWN) === 'unset')
check('the same figure matches', payoutStanding('500', OWN) === 'matches')
check('and so does the same figure with cents on it',
  payoutStanding('500.00', OWN) === 'matches')
check('more than the rate is over', payoutStanding('800', OWN) === 'over')
check('less is under', payoutStanding('400', OWN) === 'under')
check('a zero payout is a figure, not a blank', payoutStanding('0', OWN) === 'under')
check('with no rate to compare against, a typed figure stands alone',
  payoutStanding('1600', NONE) === 'no_rate')

// --- what the line under the box says ----------------------------------------

check('an untouched box shows where the rate comes from',
  payoutNote('', OWN) === OWN.reason, payoutNote('', OWN))
check('the installer is named when it is their own rate',
  payoutNote('', OWN).includes('Jay Woodward is paid'))
check('and the card is named when it is not',
  payoutNote('', CARD).includes('has no rate of their own yet'))
check('a matching figure says so', payoutNote('500', OWN).endsWith('This job is on the rate.'))
check('a figure over the rate says by how much',
  payoutNote('800', OWN).includes('$800 is $300 above it'), payoutNote('800', OWN))
check('and that it stands anyway',
  payoutNote('800', OWN).includes('stays as typed'))
check('a figure under the rate reads the same way round',
  payoutNote('400', OWN).includes('$400 is $100 below it'), payoutNote('400', OWN))
check('no rate line explains itself rather than going quiet',
  payoutNote('1600', NONE) === NONE.reason)

// --- the button --------------------------------------------------------------

check('the button says what it will put in', rateButtonLabel(OWN) === 'Use $500')
check('and says nothing when there is nothing to offer', rateButtonLabel(NONE) === '')
check('it writes a plain number', rateValue(OWN) === '500')
check('cents survive when there are any', rateValue({ ...OWN, amount: 412.5 }) === '412.50')
check('and nothing is written when there is no rate', rateValue(NONE) === '')

// --- the offer is never taken on its own -------------------------------------
//
// The whole point. A form that filled the box in would turn a rate card into a
// payroll decision nobody made, so no component may call rateValue outside the
// press of the button.

const hint = readFileSync(new URL('../src/components/PayRateHint.jsx', import.meta.url), 'utf8')
check('the hint writes only from the button press',
  /onClick=\{\(\) => onUse\(rateValue\(suggestion\)\)\}/.test(hint))
check('and it offers nothing when the box already holds the rate',
  /String\(value \?\? ''\)\.trim\(\) !== rateValue\(suggestion\)/.test(hint))

const crew = readFileSync(new URL('../src/components/JobCrewPay.jsx', import.meta.url), 'utf8')
check('the drawer saves the typed payout, never the suggestion',
  /payout_amount: draft\.payout_amount === '' \? null : Number\(draft\.payout_amount\)/.test(crew))
check('and no longer saves the fields that moved out of it',
  !/collected_by:/.test(crew) && !/valve_type:/.test(crew))

console.log(failed === 0 ? '\nAll rate checks passed.' : `\n${failed} rate check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
