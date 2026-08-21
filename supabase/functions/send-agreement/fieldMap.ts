// What each agreement type wants to prefill, and the template field names it
// will accept for each one.
//
// Names are candidates, not a contract. The function fetches the template from
// DocuSeal and matches against the names that are actually on it, so renaming
// "Customer Name" to "Client Name" keeps working, and renaming it to something
// on no list at all fails loudly instead of sending a blank agreement.
//
// Adding the subcontractor flow later means filling in the second entry below
// and giving it a sender. Nothing in index.ts is specific to customer_install.

export type FieldSpec = {
  key: string
  names: string[]
  required: boolean
  value: (job: Record<string, unknown>) => string
}

export type AgreementSpec = {
  type: string
  // which job column carries the signer's email and name
  submitterEmail: (job: Record<string, unknown>) => string
  submitterName: (job: Record<string, unknown>) => string
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

function longDate(value: unknown): string {
  const iso = text(value).slice(0, 10)
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

const CUSTOMER_INSTALL: AgreementSpec = {
  type: 'customer_install',
  submitterEmail: job => text(job.customer_email),
  submitterName: job => text(job.customer_name),
  fields: [
    {
      key: 'customer_name',
      names: ['Customer Name', 'Customer', 'Client Name', 'Name'],
      required: true,
      value: job => text(job.customer_name),
    },
    {
      key: 'address',
      names: ['Address', 'Service Address', 'Install Address', 'Street Address'],
      required: true,
      value: job => text(job.address),
    },
    {
      key: 'city',
      names: ['City', 'Service City'],
      required: false,
      value: job => text(job.city),
    },
    {
      key: 'phone',
      names: ['Phone', 'Phone Number', 'Customer Phone'],
      required: false,
      value: job => text(job.phone),
    },
    {
      key: 'email',
      names: ['Email', 'Email Address', 'Customer Email'],
      required: false,
      value: job => text(job.customer_email),
    },
    {
      key: 'system',
      names: ['System', 'System Template', 'Package', 'Equipment'],
      required: true,
      value: job => text(job.system_template),
    },
    {
      key: 'sale_price',
      names: ['Price', 'Sale Price', 'Total', 'Contract Price', 'Amount'],
      required: true,
      value: job => money(job.sale_price),
    },
    {
      key: 'invoice_number',
      names: ['Invoice', 'Invoice Number', 'Invoice #'],
      required: false,
      value: job => text(job.invoice_number),
    },
    {
      key: 'faucet_finish',
      names: ['Faucet Finish', 'Finish'],
      required: false,
      value: job => text(job.faucet_finish),
    },
    {
      key: 'install_date',
      names: ['Install Date', 'Installation Date', 'Scheduled Date', 'Date'],
      required: false,
      value: job => longDate(job.install_date || job.scheduled_date),
    },
  ],
}

// Deliberately empty. The mechanism is ready, the flow that sends one is not,
// and agreement_types.subcontractor_service is seeded inactive to match.
const SUBCONTRACTOR_SERVICE: AgreementSpec = {
  type: 'subcontractor_service',
  submitterEmail: () => '',
  submitterName: () => '',
  fields: [],
}

export const SPECS: Record<string, AgreementSpec> = {
  customer_install: CUSTOMER_INSTALL,
  subcontractor_service: SUBCONTRACTOR_SERVICE,
}

// Loose match so capitalisation, spacing and a trailing colon do not matter.
function normalise(name: string): string {
  return name.toLowerCase().replace(/[\s_:*]+/g, ' ').trim()
}

export type MatchResult = {
  fields: Array<{ name: string; default_value: string; readonly: boolean }>
  missing: string[]
  filled: string[]
}

/**
 * Matches a spec against the field names the template actually has.
 *
 * A required field with no match goes into `missing`, which the caller turns
 * into an error naming both what it wanted and what the template offers. A
 * field whose value is empty is skipped rather than sent blank and readonly,
 * which would otherwise lock the signer out of a box nobody filled.
 */
export function matchFields(
  spec: AgreementSpec,
  templateFieldNames: string[],
  job: Record<string, unknown>,
): MatchResult {
  const byNormalised = new Map<string, string>()
  for (const name of templateFieldNames) {
    byNormalised.set(normalise(name), name)
  }

  const fields: MatchResult['fields'] = []
  const missing: string[] = []
  const filled: string[] = []

  for (const field of spec.fields) {
    let actual: string | undefined
    for (const candidate of field.names) {
      const hit = byNormalised.get(normalise(candidate))
      if (hit) { actual = hit; break }
    }

    if (!actual) {
      if (field.required) missing.push(`${field.key} (looked for ${field.names.join(', ')})`)
      continue
    }

    const value = field.value(job)
    if (!value) {
      if (field.required) missing.push(`${field.key} (template has "${actual}" but the job has no value)`)
      continue
    }

    fields.push({ name: actual, default_value: value, readonly: true })
    filled.push(actual)
  }

  return { fields, missing, filled }
}
