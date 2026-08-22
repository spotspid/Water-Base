// What each agreement type prefills, and the template field names it accepts.
//
// Names are candidates, not a contract. The function fetches the template from
// DocuSeal and matches against the names actually on it, so renaming a field
// keeps working if the new name is on the list, and fails loudly if it is not.
//
// Two specs live here. customer_install matches loosely, because that template
// was built before this code and its field names are prose. subcontractor
// _service matches on one exact name each, because that template was built to
// this list and a near miss there should be an error rather than a guess.

export type Part = { sku: string; name: string; quantity: number }

// Everything a field may draw on. The job alone was enough for the customer
// agreement; a work order also needs to name the installer it is going to and
// list the parts that job will consume.
export type Context = {
  job: Record<string, unknown>
  installer: Record<string, unknown> | null
  parts: Part[]
  today: Date
}

export type FieldSpec = {
  key: string
  names: string[]
  required: boolean
  // true, the default, means prefilled and locked. false means leave it for
  // the signer, and send it explicitly so nothing else can lock it.
  readonly?: boolean
  // send the field even when the value is empty, so it is locked blank rather
  // than left open. Used for the collected by boxes, where exactly one is
  // ticked and the other must not be tickable.
  lockBlank?: boolean
  value: (ctx: Context) => string
}

export type AgreementSpec = {
  type: string
  submitterRole: string
  submitterEmail: (ctx: Context) => string
  submitterName: (ctx: Context) => string
  // what the sender has to gather before the fields can be built
  needsInstaller?: boolean
  needsParts?: boolean
  // when the template names must match exactly rather than loosely
  exactNames?: boolean
  fields: FieldSpec[]
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function money(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

// job_margin coalesces payout to 0, so zero means nobody entered one rather
// than an agreed pay of nothing. Blank leaves the box open to be filled.
function moneyIfSet(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  return money(n)
}

// A date column is YYYY-MM-DD with no zone. Splitting the parts avoids the
// UTC midnight shift that turns the 16th into the 15th.
function longDate(value: unknown): string {
  const iso = text(value).slice(0, 10)
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

function todayLong(now: Date): string {
  return now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

const CUSTOMER_INSTALL: AgreementSpec = {
  type: 'customer_install',
  submitterRole: 'Customer',
  submitterEmail: ctx => text(ctx.job.customer_email),
  submitterName: ctx => text(ctx.job.customer_name),
  fields: [
    { key: 'customer_name', required: true, names: ['Customer Name', 'Customer', 'Client Name', 'Name'],
      value: ctx => text(ctx.job.customer_name) },
    { key: 'address', required: true, names: ['Address', 'Service Address', 'Install Address', 'Street Address'],
      value: ctx => text(ctx.job.address) },
    { key: 'city', required: false, names: ['City', 'Service City'],
      value: ctx => text(ctx.job.city) },
    { key: 'phone', required: false, names: ['Phone', 'Phone Number', 'Customer Phone'],
      value: ctx => text(ctx.job.phone) },
    { key: 'email', required: false, names: ['Email', 'Email Address', 'Customer Email'],
      value: ctx => text(ctx.job.customer_email) },
    { key: 'system', required: true, names: ['System', 'System Template', 'Package', 'Equipment'],
      value: ctx => text(ctx.job.system_template) },
    { key: 'sale_price', required: true, names: ['Price', 'Sale Price', 'Total', 'Contract Price', 'Amount'],
      value: ctx => money(ctx.job.sale_price) },
    { key: 'invoice_number', required: false, names: ['Invoice', 'Invoice Number', 'Invoice #'],
      value: ctx => text(ctx.job.invoice_number) },
    { key: 'faucet_finish', required: false, names: ['Faucet Finish', 'Finish'],
      value: ctx => text(ctx.job.faucet_finish) },
    { key: 'install_date', required: false, names: ['Install Date', 'Installation Date', 'Scheduled Date', 'Date'],
      value: ctx => longDate(ctx.job.install_date || ctx.job.scheduled_date) },
  ],
}

// The work order. Field names are exactly as they appear on template 5532104.
//
// Only subcontractor_signature and subcontractor_date are left open. Everything
// else arrives filled and locked, including the company countersignature, so
// the installer receives a finished document rather than a form to complete.
const SUBCONTRACTOR_SERVICE: AgreementSpec = {
  type: 'subcontractor_service',
  submitterRole: 'Subcontractor',
  needsInstaller: true,
  needsParts: true,
  exactNames: true,
  submitterEmail: ctx => text(ctx.installer?.email),
  submitterName: ctx => text(ctx.installer?.name),
  fields: [
    { key: 'job_number', required: true, names: ['job_number'],
      value: ctx => text(ctx.job.invoice_number) },
    { key: 'date_issued', required: true, names: ['date_issued'],
      value: ctx => todayLong(ctx.today) },
    { key: 'subcontractor', required: true, names: ['subcontractor'],
      value: ctx => text(ctx.installer?.name) },
    { key: 'customer_name', required: true, names: ['customer_name'],
      value: ctx => text(ctx.job.customer_name) },
    { key: 'phone', required: false, names: ['phone'],
      value: ctx => text(ctx.job.phone) },
    { key: 'install_address', required: true, names: ['install_address'],
      value: ctx => text(ctx.job.address) },
    { key: 'city', required: false, names: ['city'],
      value: ctx => text(ctx.job.city) },
    { key: 'scheduled_window', required: false, names: ['scheduled_window'],
      value: ctx => {
        const day = longDate(ctx.job.scheduled_date || ctx.job.install_date)
        const window = text(ctx.job.time_window)
        if (day && window) return `${day}, ${window}`
        return day || window
      } },

    // the system as sold, with the two choices that decide which parts go on
    // the truck
    { key: 'systems', required: true, names: ['systems'],
      value: ctx => {
        const picks = [text(ctx.job.ro_type), text(ctx.job.faucet_finish)].filter(Boolean)
        const base = text(ctx.job.system_template)
        return picks.length > 0 ? `${base} (${picks.join(', ')})` : base
      } },

    // the point of the document. One line per part, quantity first, from the
    // same resolver the reservations use, so the sheet cannot disagree with
    // what the job actually holds.
    { key: 'additional_items', required: false, names: ['additional_items'],
      value: ctx => ctx.parts.length === 0
        ? 'No parts list on this build sheet'
        : ctx.parts.map(p => `${p.quantity} x ${p.name} (${p.sku})`).join('\n') },

    // blank when no payout has been entered, and deliberately not locked in
    // that case, so it can still be filled in
    { key: 'agreed_pay', required: false, names: ['agreed_pay'],
      value: ctx => moneyIfSet(ctx.job.installer_pay) },
    { key: 'payment_terms', required: false, names: ['payment_terms'],
      value: () => '' },

    // exactly one box carries an X. The other is sent blank and locked, so it
    // cannot be ticked as well.
    { key: 'collected_by_company', required: false, names: ['collected_by_company'],
      lockBlank: true, value: () => 'X' },
    { key: 'collected_by_subcontractor', required: false, names: ['collected_by_subcontractor'],
      lockBlank: true, value: () => '' },

    { key: 'company_signature', required: true, names: ['company_signature'],
      value: () => 'Michigan Water Pros' },
    { key: 'company_date', required: true, names: ['company_date'],
      value: ctx => todayLong(ctx.today) },

    // the only two the installer touches
    { key: 'subcontractor_signature', required: true, names: ['subcontractor_signature'],
      readonly: false, value: () => '' },
    { key: 'subcontractor_date', required: true, names: ['subcontractor_date'],
      readonly: false, value: () => '' },
  ],
}

export const SPECS: Record<string, AgreementSpec> = {
  customer_install: CUSTOMER_INSTALL,
  subcontractor_service: SUBCONTRACTOR_SERVICE,
}

// Loose match, so capitalisation, spacing and a trailing colon do not matter.
function normalise(name: string): string {
  return name.toLowerCase().replace(/[\s_:*]+/g, ' ').trim()
}

export type MatchResult = {
  fields: Array<{ name: string; default_value: string; readonly: boolean }>
  missing: string[]
  filled: string[]
  openToSigner: string[]
}

/**
 * Matches a spec against the field names the template actually has.
 *
 * A required field with no match goes into `missing`, which the caller turns
 * into an error naming both what it wanted and what the template offers.
 *
 * Three shapes of field come out:
 *   readonly false   sent empty and unlocked, for the signer to complete
 *   lockBlank        sent even when empty, so it is locked rather than open
 *   everything else  sent only when it has a value, because a blank readonly
 *                    field would otherwise lock the signer out of a box that
 *                    nobody filled
 */
export function matchFields(
  spec: AgreementSpec,
  templateFieldNames: string[],
  ctx: Context,
): MatchResult {
  const byExact = new Map<string, string>()
  const byNormalised = new Map<string, string>()
  for (const name of templateFieldNames) {
    byExact.set(name, name)
    byNormalised.set(normalise(name), name)
  }

  const fields: MatchResult['fields'] = []
  const missing: string[] = []
  const filled: string[] = []
  const openToSigner: string[] = []

  for (const field of spec.fields) {
    let actual: string | undefined
    for (const candidate of field.names) {
      const hit = spec.exactNames ? byExact.get(candidate) : byNormalised.get(normalise(candidate))
      if (hit) { actual = hit; break }
    }

    if (!actual) {
      if (field.required) missing.push(`${field.key} (looked for ${field.names.join(', ')})`)
      continue
    }

    if (field.readonly === false) {
      fields.push({ name: actual, default_value: '', readonly: false })
      openToSigner.push(actual)
      continue
    }

    const value = field.value(ctx)

    if (!value && !field.lockBlank) {
      if (field.required) missing.push(`${field.key} (template has "${actual}" but there is no value for it)`)
      continue
    }

    fields.push({ name: actual, default_value: value, readonly: true })
    if (value) filled.push(actual)
  }

  return { fields, missing, filled, openToSigner }
}
