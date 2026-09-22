import { readFileSync } from 'node:fs'
import { SPECS } from '../supabase/functions/send-agreement/fieldMap.ts'

// Checks the long descriptive name of a build sheet.
//
// A build sheet has two names. "Flagship Bundle" is what the office calls it,
// and it is what the quote, the agreement and the work order used to print at
// a customer. The long name is the one a customer reads, and the RO clause is
// composed onto it per job from the RO type.
//
// The composing itself is SQL, in 20260922020000_long_system_names.sql, with
// its own proof block. What this covers is the other half: that the documents
// use the long name when there is one, that they print exactly what they
// printed before when there is not, and that the RO is never said twice.
//
// Run with: npm run check:longname

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const LONG = 'Whole home water softening system plus under sink tanked reverse osmosis '
  + 'system and separate faucet for drinking water'

function systemsOf(specKey, job) {
  const spec = SPECS[specKey]
  const field = spec.fields.find(f => f.key === 'systems')
  return field.value({ job, installer: null, parts: [], today: new Date('2026-09-22') })
}

const withLong = {
  system_template: 'Flagship Bundle', system_long_name: LONG,
  ro_type: 'Tank Style', faucet_finish: 'Chrome', valve_type: 'Clack',
}
const withoutLong = { ...withLong, system_long_name: null }

// --- the customer agreement ---------------------------------------------------

check('the agreement prints the long name', systemsOf('customer_install', withLong).startsWith(LONG),
  systemsOf('customer_install', withLong))
check('and does not repeat the RO after it',
  !systemsOf('customer_install', withLong).includes('Tank Style'),
  systemsOf('customer_install', withLong))
check('the finish still rides along, because the long name does not say it',
  systemsOf('customer_install', withLong) === `${LONG} (Chrome)`,
  systemsOf('customer_install', withLong))

// --- the work order -----------------------------------------------------------

check('the work order prints the long name with the finish and the valve',
  systemsOf('subcontractor_service', withLong) === `${LONG} (Chrome, Clack)`,
  systemsOf('subcontractor_service', withLong))

// --- a sheet with no long name yet prints what it printed before ---------------

check('the agreement falls back to the short name and every pick',
  systemsOf('customer_install', withoutLong) === 'Flagship Bundle (Tank Style, Chrome)',
  systemsOf('customer_install', withoutLong))
check('and so does the work order',
  systemsOf('subcontractor_service', withoutLong) === 'Flagship Bundle (Tank Style, Chrome, Clack)',
  systemsOf('subcontractor_service', withoutLong))
check('a blank long name is treated as none',
  systemsOf('customer_install', { ...withLong, system_long_name: '   ' })
    === 'Flagship Bundle (Tank Style, Chrome)')

// --- no RO --------------------------------------------------------------------
//
// The composer leaves the clause off, and N/A is the faucet finish of a job
// with no RO: a real answer on the job, and nothing to a customer, who would
// read "(N/A)" and wonder what had been left out.

const noRo = {
  system_template: 'Flagship Bundle', system_long_name: 'Whole home water softening system',
  ro_type: 'No RO', faucet_finish: 'N/A', valve_type: 'Clack',
}
check('a no RO job prints its base name with no faucet in brackets',
  systemsOf('customer_install', noRo) === 'Whole home water softening system',
  systemsOf('customer_install', noRo))
check('and the work order still names the valve',
  systemsOf('subcontractor_service', noRo) === 'Whole home water softening system (Clack)',
  systemsOf('subcontractor_service', noRo))
check('N/A is kept out of the fallback too',
  !systemsOf('customer_install', { ...noRo, system_long_name: null }).includes('N/A'),
  systemsOf('customer_install', { ...noRo, system_long_name: null }))

// --- the quote ----------------------------------------------------------------
//
// The quote's system name is chosen in index.ts, which reads a database and
// so cannot be called here. Read instead, because the fallback is the part
// that matters: a sheet with no long name must still send the quote it sends
// today rather than the word "undefined".

const index = readFileSync(new URL('../supabase/functions/send-agreement/index.ts', import.meta.url), 'utf8')
check('the quote uses the long name when there is one',
  /systemName:\s*String\(job\.system_long_name\s*\|\|/.test(index))
check('and falls back to the short name, then to a plain description',
  /job\.system_long_name\s*\|\|\s*job\.system_template\s*\|\|\s*'water system'/.test(index))
check('the long name is read from the job, beside the checklist',
  /select\('sales_checklist,\s*system_long_name'\)/.test(index))

// --- the clauses, as the database composes them -------------------------------

const sql = readFileSync(new URL('../supabase/migrations/20260922020000_long_system_names.sql', import.meta.url), 'utf8')
check('tanked has the wording from the brief',
  sql.includes("when 'Tank Style' then ' plus under sink tanked reverse osmosis system and separate faucet for drinking water'"))
check('tankless has its own, matching wording',
  sql.includes("when 'Tankless'   then ' plus under sink tankless reverse osmosis system and separate faucet for drinking water'"))
check('and No RO adds nothing', /else ''/.test(sql))
// An assignment to the column, not a mention of it: public.system_templates
// contains the words "system_template", which the first version of this
// check read as the job's short name being rewritten.
check('the short name is never assigned to by any of it',
  !/\bsystem_template\s*(:?=)[^=]/.test(sql),
  (sql.match(/.*\bsystem_template\s*(:?=)[^=].*/) || [''])[0].trim())

console.log(failed === 0 ? '\nAll long name checks passed.' : `\n${failed} long name check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
