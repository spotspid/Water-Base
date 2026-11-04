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

// The real sentence a Flagship Bundle job with a tanked RO composes to,
// since 20260926060000 put David's wording on the four named sheets.
const LONG = 'Whole home single tank mixed bed system for filtration and softening '
  + 'plus under sink tanked reverse osmosis system for drinking water'

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

const sql = readFileSync(new URL('../supabase/migrations/20260926060000_long_names_from_david.sql', import.meta.url), 'utf8')
check('tanked has the wording from the brief',
  sql.includes("when 'Tank Style' then ' plus under sink tanked reverse osmosis system for drinking water'"))
check('tankless has its own, matching wording',
  sql.includes("when 'Tankless'   then ' plus under sink tankless reverse osmosis system for drinking water'"))
check('and No RO adds nothing', /else ''/.test(sql))

// RO Only is an RO. Composing the clause onto it said it twice, so a label
// that already names one is returned as it stands.
check('a sheet that already names an RO takes no clause',
  /~\*\s*'reverse osmosis'\s*then btrim\(p_long_label\)/.test(sql),
  (sql.match(/.*reverse osmosis'\s*then.*/) || [''])[0].trim())
check('the four sheets are named, and Custom is not',
  ['Well Water Bundle', 'Flagship Bundle', 'Softener Only', 'RO Only'].every(l => sql.includes(`when '${l}'`))
  && !/when 'Custom'/.test(sql))
check('and the jobs already written are recomposed rather than left behind',
  /update public\.jobs[\s\S]*set system_long_name = public\.compose_system_long_name/.test(sql))
// An assignment to the column, not a mention of it: public.system_templates
// contains the words "system_template", which the first version of this
// check read as the job's short name being rewritten.
check('the short name is never assigned to by any of it',
  !/\bsystem_template\s*(:?=)[^=]/.test(sql),
  (sql.match(/.*\bsystem_template\s*(:?=)[^=].*/) || [''])[0].trim())

/* ---------------------------------------------------------------------------
   A typed description, which the Custom sheet made necessary
--------------------------------------------------------------------------- */

// The Custom sheet has no long label, so three signed agreements described
// their purchase as the word "Custom": April Y. Stone at $2,899, Prudhvi
// Yalavarthi at $3,949 and Donna Burgess at $2,000. The documents already
// prefer the long name, so the fix was to let somebody type one.

const typed = readFileSync(
  new URL('../supabase/migrations/20261104120000_a_job_can_say_what_it_is.sql', import.meta.url),
  'utf8',
)

check('a typed description is left alone by the composing trigger',
  /if new\.system_long_name_typed then\s*\n\s*return new;/.test(typed))
check('and the trigger wakes on the flag, so clearing one recomposes',
  /before insert or update of template_id, ro_type, system_long_name_typed/.test(typed))
check('the save takes a description', /p_system_description text/.test(typed))
check('and writes it into the column the documents already read',
  /system_long_name = case when v_desc is not null then v_desc else system_long_name end/.test(typed))
check('and marks whose it is',
  /system_long_name_typed = \(v_desc is not null\)/.test(typed))
check('the three stale overloads are dropped, so a save cannot pick the wrong one',
  (typed.match(/drop function if exists public\.update_job_details/g) || []).length === 3)
check('and the proof insists exactly one is left',
  /There are % versions of update_job_details/.test(typed))
check('clearing the description is allowed, unlike the fields that cannot be emptied',
  !/v_cleared \|\| 'the description'/.test(typed))
check('it is capped, because it prints in a box', /length\(v_desc\) > 500/.test(typed))

// The documents are the point: a typed sentence has to reach both of them.
const typedJob = {
  system_template: 'Custom',
  system_long_name: 'Two under sink RO units, and replacing the PEX run to the kitchen',
  ro_type: 'Tank Style',
  faucet_finish: 'Chrome',
}
const TYPED = 'Two under sink RO units, and replacing the PEX run to the kitchen'

check('a typed description is what the customer agreement says',
  systemsOf('customer_install', typedJob).startsWith(TYPED),
  systemsOf('customer_install', typedJob))
check('and what the work order says',
  systemsOf('subcontractor_service', typedJob).startsWith(TYPED),
  systemsOf('subcontractor_service', typedJob))
check('and the RO type is not repeated after a sentence that already covers it',
  !systemsOf('customer_install', typedJob).includes('Tank Style'),
  systemsOf('customer_install', typedJob))
check('a Custom job with no description prints only its name, which is the bug',
  systemsOf('customer_install', { system_template: 'Custom', system_long_name: null }) === 'Custom',
  systemsOf('customer_install', { system_template: 'Custom', system_long_name: null }))

// The form must not prefill a composed description, or every save of a bundle
// would turn its generated sentence into a typed one and stop it following the
// build sheet.
const jobEdit = readFileSync(new URL('../src/lib/jobEdit.js', import.meta.url), 'utf8')

check('the form only prefills a description somebody typed',
  /system_description: job\.system_long_name_typed \? \(job\.system_long_name \|\| ''\) : ''/
    .test(jobEdit))
check('and the save sends it',
  /p_system_description: form\.system_description\.trim\(\) \|\| null/.test(jobEdit))

console.log(failed === 0 ? '\nAll long name checks passed.' : `\n${failed} long name check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
