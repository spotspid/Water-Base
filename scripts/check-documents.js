import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

// Can a v2 job actually produce a document?
//
// send-agreement refuses a document when a required field has no value, and
// the refusal arrives from DocuSeal after somebody presses send. This asks the
// question before that, against the real field map rather than a copy of its
// rules, by compiling it and running matchFields the way the function does.
//
// It exists because a v2 job was silently unsendable for a week: the schema
// called the system column system_name and the field map reads system_template,
// so the value was there under a name nothing looked for, and the only symptom
// would have been "systems: there is no value for it" at the worst moment.

const FIELD_NAMES = {
  customer_install: [
    'customer_name', 'install_address', 'city', 'phone', 'email', 'systems',
    'sale_price', 'payment_schedule', 'company_signature', 'company_date',
    'company_printed_name', 'customer_signature', 'customer_printed_name', 'customer_date',
  ],
  subcontractor_service: [
    'job_number', 'date_issued', 'subcontractor', 'customer_name', 'phone',
    'install_address', 'city', 'scheduled_window', 'site_conditions', 'systems',
    'parts_system', 'parts_finish', 'parts_list', 'agreed_pay', 'payment_terms',
    'balance_due', 'collected_by_company', 'collected_by_subcontractor',
    'company_signature', 'company_date', 'subcontractor_signature', 'subcontractor_date',
  ],
}

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// The field map is TypeScript and Deno flavoured, so it is compiled here
// rather than imported. Compiling the real file is the point: a copy of its
// rules would pass while the file it describes had changed.
const out = mkdtempSync(join(tmpdir(), 'wb-fieldmap-'))

// tsc exits non-zero on the Deno style ".ts" import in the field map and emits
// the file anyway, so the exit code is ignored and the emitted file is what is
// checked. If it genuinely failed, the import below throws and says so.
try {
  execFileSync('npx', [
  '-y', '-p', 'typescript', 'tsc',
  'supabase/functions/send-agreement/fieldMap.ts',
  '--outDir', out, '--target', 'es2022', '--module', 'esnext',
  '--moduleResolution', 'bundler', '--skipLibCheck',
  ], { stdio: 'pipe', shell: process.platform === 'win32' })
} catch {
  // see above
}

const compiled = join(out, 'fieldMap.js')
writeFileSync(compiled, readFileSync(compiled, 'utf8').split('siteConditions.ts').join('siteConditions.js'))

const { SPECS, matchFields } = await import(pathToFileURL(compiled).href)

function missingFor(type, job, extra = {}) {
  const ctx = { job, installer: null, parts: [], today: new Date('2026-10-23'), ...extra }
  return matchFields(SPECS[type], FIELD_NAMES[type], ctx).missing
}

// --- the customer agreement --------------------------------------------------

// What the quoting page guarantees before it lets anybody press send.
const SENDABLE_QUOTE = {
  customer_name: 'Warren Woodruff',
  customer_email: 'warren@example.com',
  phone: '(248) 496-8292',
  system_template: 'Flagship Bundle',
  sale_price: 3499,
}

check('a quote the page calls sendable produces a customer agreement',
  missingFor('customer_install', SENDABLE_QUOTE).length === 0,
  missingFor('customer_install', SENDABLE_QUOTE).join('; '))

check('and it still sends with no address, which the customer fills in',
  missingFor('customer_install', { ...SENDABLE_QUOTE, address: '' }).length === 0)

// Each of the four the page now asks for, dropped one at a time. If one of
// these ever stops blocking, the page is asking for something it need not.
for (const [field, label] of [
  ['phone', 'a phone number'],
  ['system_template', 'a system'],
  ['sale_price', 'a price'],
]) {
  const without = { ...SENDABLE_QUOTE }
  delete without[field]

  check(`without ${label} the document is refused, which is why the page asks`,
    missingFor('customer_install', without).length > 0)
}

// --- the work order ----------------------------------------------------------

const SENDABLE_JOB = {
  ...SENDABLE_QUOTE,
  address: '6972 Cottonwood Knoll',
  invoice_number: 'MWP-0031',
  installer_pay: 500,
  parts_list: 'Mixed bed system, control valve, tanked RO, RO faucet, 2 bags of salt',
}

const crew = { installer: { name: 'Jay Woodward' }, parts: [] }

check('a sold v2 job produces a work order',
  missingFor('subcontractor_service', SENDABLE_JOB, crew).length === 0,
  missingFor('subcontractor_service', SENDABLE_JOB, crew).join('; '))

check('it sends with no address, so a booked job is never left with no paperwork',
  missingFor('subcontractor_service', { ...SENDABLE_JOB, address: '' }, crew).length === 0,
  missingFor('subcontractor_service', { ...SENDABLE_JOB, address: '' }, crew).join('; '))

check('and refuses without an invoice number, which is why they assign themselves',
  missingFor('subcontractor_service', { ...SENDABLE_JOB, invoice_number: '' }, crew).length > 0)

// The parts list is the whole reason a v2 job can have a work order at all.
const spec = SPECS.subcontractor_service
const partsField = spec.fields.find(f => f.key === 'parts_list')
const typed = partsField.value({ job: SENDABLE_JOB, installer: null, parts: [], today: new Date() })

check('a typed parts list reaches the work order when nothing is resolved',
  typed === SENDABLE_JOB.parts_list, typed)

const resolvedWins = partsField.value({
  job: SENDABLE_JOB, installer: null, today: new Date(),
  parts: [{ quantity: 1, name: '10x54 Mixed Bed System', sku: 'MB-1054' }],
})

check('and a resolved list still wins when there is one',
  resolvedWins.includes('MB-1054'), resolvedWins)

console.log(failed === 0
  ? '\nA v2 job can produce both documents.'
  : `\n${failed} document check(s) failed. A job would be refused at send time.`)

process.exitCode = failed === 0 ? 0 : 1
