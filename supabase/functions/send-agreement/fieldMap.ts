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

import { workOrderSiteConditions } from './siteConditions.ts'

export type Part = { sku: string; name: string; quantity: number; category?: string }

// Which half of the work order a part is listed in.
//
// The page splits the job the way the van is loaded: the whole home hardware
// on one side, the under sink work and consumables on the other. A category
// that is in neither list goes in the finish half rather than being dropped,
// because a part missing from the sheet is a part left in the warehouse.
export const SYSTEM_CATEGORIES = ['System', 'Tank', 'Valve', 'Media']
export const FINISH_CATEGORIES = ['RO', 'Faucet', 'Filter', 'Consumable', 'Fittings']

export function partGroup(category: unknown): 'system' | 'finish' {
  return SYSTEM_CATEGORIES.includes(String(category ?? '').trim()) ? 'system' : 'finish'
}

// One line per part, quantity first, as the single list always printed.
export function partLines(parts: Part[]): string {
  return parts.map(p => `${p.quantity} x ${p.name} (${p.sku})`).join('\n')
}

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
  // Boxes that are optional one by one but not all together. Satisfied when
  // every key in at least one set is on the template. Lets a template carry
  // either the split parts boxes or the old single one, and refuses a
  // template with neither, or with only half of the split.
  requireOneOf?: Array<{ label: string; sets: string[][] }>
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

// Money where zero is a real answer but absent is not.
//
// money() cannot serve here, because Number(null) is 0 and so a balance nobody
// could work out would print as $0.00, which tells an installer to collect
// nothing on a job that might owe two thousand dollars. Absent has to stay
// absent and leave the box open.
function moneyKnown(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  return money(value)
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

// The deposit agreed at quoting, when there is one. Null (never recorded) and
// zero (none agreed) both mean the whole price is due on completion, which is
// what every agreement said before the deposit existed.
function agreedDeposit(ctx: Context): number {
  const n = Number(ctx.job.deposit_amount)
  return Number.isFinite(n) && n > 0.005 ? n : 0
}

// The payment terms as one sentence, so a single box on the template carries
// both cases and nobody has to keep two versions of the page. The balance here
// is the price less the agreed deposit, a term, and not the price less what has
// been paid, which is a fact about today that the contract must not move with.
function paymentSchedule(ctx: Context): string {
  const price = Number(ctx.job.sale_price)
  if (!Number.isFinite(price)) return ''

  const deposit = agreedDeposit(ctx)
  if (deposit === 0) {
    return `Full payment of ${money(price)} is due upon installation completion.`
  }

  const balance = Math.round((price - deposit) * 100) / 100
  return `A deposit of ${money(deposit)} is due at signing. `
    + `The balance of ${money(balance)} is due upon installation completion.`
}

// One question, asked by both collected by boxes, so they can never agree
// with each other by both being ticked or both being blank.
function collectedBySubcontractor(ctx: Context): boolean {
  return text(ctx.job.collected_by).toLowerCase() === 'subcontractor'
}

// Prefilled on every work order. Both are company facts rather than job facts,
// so they live here as constants rather than as columns nobody would ever edit
// per job. If either changes, it changes in one place.
const COMPANY_SIGNATORY = 'Steve Burgess'
const PAYMENT_TERMS = 'Paid weekly on Fridays'

// The customer agreement, against template 5520400.
//
// Names are exact. The template was rebuilt on 2026-09-16 with a new PDF, and
// this spec matches it box for box: fourteen boxes, all on the one role, First
// Party. A box the template requires is required here too, so a rename in
// DocuSeal stops the send with a message rather than printing a blank.
//
// Left for the signer: customer_signature and customer_printed_name. The date
// beside the customer signature has no name on the template, so it cannot be
// addressed and stays open to the signer anyway; customer_date is kept
// optional so naming that box starts working with no change here. Everything
// else, including the company countersignature and printed name, arrives
// filled and locked.
const CUSTOMER_INSTALL: AgreementSpec = {
  type: 'customer_install',
  submitterRole: 'Customer',
  exactNames: true,
  submitterEmail: ctx => text(ctx.job.customer_email),
  submitterName: ctx => text(ctx.job.customer_name),
  fields: [
    { key: 'customer_name', required: true, names: ['customer_name'],
      value: ctx => text(ctx.job.customer_name) },

    // Street only. The template carries a city box of its own, drawn on the
    // page and marked required, so putting the city in both would print it
    // twice and leaving the city box empty would leave a required field blank
    // that nobody is allowed to type in.
    { key: 'install_address', required: true, names: ['install_address'],
      value: ctx => text(ctx.job.address) },
    { key: 'city', required: false, names: ['city'],
      value: ctx => text(ctx.job.city) },

    // On the template since the 2026-09-16 rebuild, and required there. The
    // column is NOT NULL on jobs, so every job has something to put in it.
    { key: 'phone', required: true, names: ['phone'],
      value: ctx => text(ctx.job.phone) },

    { key: 'email', required: true, names: ['email'],
      value: ctx => text(ctx.job.customer_email) },

    // What was sold, with the two choices that decide what turns up. The work
    // order prints the same sentence plus the valve type, which the installer
    // needs and the customer never chose.
    { key: 'systems', required: true, names: ['systems'],
      value: ctx => {
        const picks = [text(ctx.job.ro_type), text(ctx.job.faucet_finish)].filter(Boolean)
        const base = text(ctx.job.system_template)
        return picks.length > 0 ? `${base} (${picks.join(', ')})` : base
      } },

    { key: 'sale_price', required: true, names: ['sale_price'],
      value: ctx => money(ctx.job.sale_price) },

    // The sentence that replaced the printed "full payment is due upon
    // installation completion". Deposit now and balance on completion when a
    // deposit was agreed, full payment on completion when none was. It carries
    // the deposit figure itself, which is why the template has no separate
    // deposit box. Locked: a customer does not get to type their own terms.
    { key: 'payment_schedule', required: true, names: ['payment_schedule'],
      value: ctx => paymentSchedule(ctx) },

    { key: 'company_signature', required: true, names: ['company_signature'],
      value: () => COMPANY_SIGNATORY },
    { key: 'company_date', required: true, names: ['company_date'],
      value: ctx => todayLong(ctx.today) },
    // Printed under the countersignature, from the same constant, so the
    // signature and the name beside it cannot disagree.
    { key: 'company_printed_name', required: true, names: ['company_printed_name'],
      value: () => COMPANY_SIGNATORY },

    // What the customer completes. The printed name is typed by them rather
    // than prefilled from the job: it records who actually signed, which is
    // not always the person the job was written up for.
    { key: 'customer_signature', required: true, names: ['customer_signature'],
      readonly: false, value: () => '' },
    { key: 'customer_printed_name', required: true, names: ['customer_printed_name'],
      readonly: false, value: () => '' },
    // Unnamed on the template today, so nothing matches and the box stays
    // open to the signer. Optional so that naming it needs no change here.
    { key: 'customer_date', required: false, names: ['customer_date'],
      readonly: false, value: () => '' },
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
  requireOneOf: [{
    label: 'the parts list',
    sets: [['parts_system', 'parts_finish'], ['parts_list']],
  }],
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

    // What the installer needs to know about the house before he gets there.
    // What the office typed on the job, then the two sales checklist answers
    // that matter at the door: where the main shutoff is, and whether old
    // equipment comes out and at what charge. Sent blank and locked when there
    // is none of either, rather than filled with a placeholder saying there is
    // nothing to say.
    { key: 'site_conditions', required: false, names: ['site_conditions'],
      lockBlank: true,
      value: ctx => workOrderSiteConditions(ctx.job.site_conditions, ctx.job.sales_checklist) },

    // the system as sold, with the three choices that decide which parts go
    // on the truck. The valve type is here and not on the customer agreement:
    // the installer has to know which control valve to take, and the customer
    // never chose it.
    { key: 'systems', required: true, names: ['systems'],
      value: ctx => {
        const picks = [
          text(ctx.job.ro_type), text(ctx.job.faucet_finish), text(ctx.job.valve_type),
        ].filter(Boolean)
        const base = text(ctx.job.system_template)
        return picks.length > 0 ? `${base} (${picks.join(', ')})` : base
      } },

    // the point of the document, in two columns since template 5532104 was
    // split on 2026-09-16. One line per part, quantity first, from the same
    // resolver the reservations and the install use, so the sheet cannot
    // disagree with what the job actually holds.
    //
    // A half with nothing in it prints "None" and is locked, rather than
    // left as an open box the installer could write a part into.
    { key: 'parts_system', required: false, names: ['parts_system'],
      value: ctx => partLines(ctx.parts.filter(p => partGroup(p.category) === 'system')) || 'None' },
    { key: 'parts_finish', required: false, names: ['parts_finish'],
      value: ctx => partLines(ctx.parts.filter(p => partGroup(p.category) === 'finish')) || 'None' },

    // The old single box, kept as a fallback so a template that still has it
    // fills rather than breaking. additional_items is the name before that.
    { key: 'parts_list', required: false,
      names: ['parts_list', 'additional_items'],
      value: ctx => (ctx.parts.length === 0
        ? 'No parts list on this build sheet'
        : partLines(ctx.parts)) },

    // Always locked, with no exception.
    //
    // This was previously omitted when no payout had been entered, on the
    // reasoning that an empty box could then still be filled in. That is
    // exactly the problem: the person filling it in is the subcontractor, and
    // he was being handed an open input to type his own pay into. lockBlank
    // sends the field whether or not there is a figure, so the worst case is a
    // blank box nobody can write in rather than an editable one.
    //
    // The send is refused outright when there is no payout, so the blank case
    // should be unreachable. This is the second lock on the same door.
    { key: 'agreed_pay', required: false, names: ['agreed_pay'],
      lockBlank: true, value: ctx => moneyIfSet(ctx.job.installer_pay) },
    { key: 'payment_terms', required: false, names: ['payment_terms'],
      value: () => PAYMENT_TERMS },

    // What is still owed on the day, so the installer collects the right
    // amount rather than asking for the whole price on a job that already
    // paid half of it. Sits beside the collected by boxes, which say who takes
    // it, and answers how much.
    //
    // Optional, and offered under a few names, because this field may not
    // exist on the template yet. A template without it sends exactly as
    // before; adding a box called balance_due starts filling it with no
    // further change here.
    //
    // Zero is a real answer and prints as $0.00: paid in full is something the
    // installer needs told, and a blank box would read as nobody having
    // checked.
    { key: 'balance_due', required: false,
      names: ['balance_due', 'amount_to_collect', 'balance_to_collect'],
      value: ctx => moneyKnown(ctx.job.balance_due) },

    // exactly one box carries an X. The other is sent blank and locked, so it
    // cannot be ticked as well.
    //
    // Which one is a fact about the job, chosen beside crew and pay. It used
    // to be hardcoded to the company, so a subcontractor who took the payment
    // signed a document saying he had not. Anything other than
    // 'subcontractor', including a job read before the column existed, is the
    // company, which is what every work order sent before this said.
    { key: 'collected_by_company', required: false, names: ['collected_by_company'],
      lockBlank: true, value: ctx => (collectedBySubcontractor(ctx) ? '' : 'X') },
    { key: 'collected_by_subcontractor', required: false, names: ['collected_by_subcontractor'],
      lockBlank: true, value: ctx => (collectedBySubcontractor(ctx) ? 'X' : '') },

    { key: 'company_signature', required: true, names: ['company_signature'],
      value: () => COMPANY_SIGNATORY },
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

  // a group of boxes that must be there as a set, in one of several forms
  const present = (key: string) => {
    const field = spec.fields.find(f => f.key === key)
    return Boolean(field && field.names.some(candidate => (spec.exactNames
      ? byExact.has(candidate)
      : byNormalised.has(normalise(candidate)))))
  }

  for (const group of spec.requireOneOf || []) {
    if (!group.sets.some(set => set.every(present))) {
      missing.push(`${group.label} (looked for ${group.sets.map(set => set.join(' and ')).join(', or ')})`)
    }
  }

  return { fields, missing, filled, openToSigner }
}
