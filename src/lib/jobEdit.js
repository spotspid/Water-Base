import { supabase } from './supabase'
import { attempt } from './errors'

// Editing a saved job. The form's shape, its validation, and the one call
// that saves it.
//
// The validation here is the same set update_job_details enforces, and that is
// deliberate rather than duplicated by accident. The database is the one that
// has to be right, because it is what a second tab or a future caller goes
// through. This copy exists so a person gets told about a blank phone number
// without a round trip. If the two ever disagree the database wins, and its
// sentence is what the drawer shows.
//
// What is not here: status, the date, the crew, the pay and the install date.
// Those have their own writers, and a second path that wrote them with a plain
// update is how "Mark scheduled" used to disagree with the calendar.

export const EDITABLE_FIELDS = [
  'customer_name', 'phone', 'customer_email', 'address', 'city', 'water_source',
  'system_template', 'sale_price', 'payment_type', 'faucet_finish', 'ro_type',
  'valve_type', 'invoice_number', 'site_conditions', 'notes',
]

// What an installed job will not let go of, and why. Shown before anybody
// types rather than after they try to save, because a form that accepts a
// change it is going to refuse is a worse form than one that says so first.
export const LOCKED_WHEN_INSTALLED = [
  'system_template', 'faucet_finish', 'ro_type', 'valve_type', 'invoice_number',
]

export const LOCKED_REASON =
  'This job is installed and its parts are in the ledger, which is append only. '
  + 'The build sheet, the finish, the RO type, the valve type and the invoice number '
  + 'are what those ledger rows were written from, so they are read only here. '
  + 'Everything else can still be corrected. Reverse the install if the parts were wrong.'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The job row as the form wants it. Every value is a string, because that is
// what an input holds, and null would render as the word null.
export function formFromJob(job) {
  return {
    customer_name: job.customer_name || '',
    phone: job.phone || '',
    customer_email: job.customer_email || '',
    address: job.address || '',
    city: job.city || '',
    water_source: job.water_source || 'city',
    system_template: job.system_template || '',
    sale_price: job.sale_price == null ? '' : String(job.sale_price),
    payment_type: job.payment_type || '',
    faucet_finish: job.faucet_finish || '',
    ro_type: job.ro_type || '',
    valve_type: job.valve_type || '',
    invoice_number: job.invoice_number || '',
    site_conditions: job.site_conditions || '',
    notes: job.notes || '',
  }
}

export function isDirty(form, job) {
  const original = formFromJob(job)
  return EDITABLE_FIELDS.some(name => (form[name] || '') !== (original[name] || ''))
}

/**
 * The first problem with the form, or an empty string.
 *
 * hasOwnParts relaxes the build sheet requirement: a job listing its own parts
 * needs no sheet, and demanding one would be asking for a list it is not going
 * to use.
 */
export function validateEdit(form, { hasOwnParts = false } = {}) {
  if (!form.customer_name.trim()) return 'Customer name is required.'
  if (!form.phone.trim()) return 'Phone is required.'
  if (!form.address.trim()) return 'Address is required.'

  const email = form.customer_email.trim()
  if (email && !EMAIL.test(email)) return 'That email address does not look right.'

  if (!form.city) return 'Pick a city.'
  if (!form.payment_type) return 'Pick a payment type.'
  if (!form.invoice_number.trim()) return 'Invoice number is required.'

  if (!form.system_template && !hasOwnParts) {
    return 'Pick a system template, or list this job’s parts against the job itself.'
  }

  const price = Number(form.sale_price)
  if (!Number.isFinite(price) || price < 0) return 'Sale price must be zero or greater.'

  return ''
}

/**
 * Save, and say what it did to the claim.
 *
 * Returns { error } or { message }, both already sentences, matching every
 * other action in jobActions so the drawer handles one shape.
 */
export async function saveJobDetails(job, form, templateId) {
  const { data, error } = await attempt(
    () => supabase.rpc('update_job_details', {
      p_job_id: job.id,
      p_customer_name: form.customer_name.trim(),
      p_phone: form.phone.trim(),
      p_customer_email: form.customer_email.trim() || null,
      p_address: form.address.trim(),
      p_city: form.city,
      p_water_source: form.water_source,
      p_template_id: templateId || null,
      p_sale_price: Number(form.sale_price),
      p_payment_type: form.payment_type,
      p_faucet_finish: form.faucet_finish || null,
      p_ro_type: form.ro_type || null,
      p_valve_type: form.valve_type || null,
      p_invoice_number: form.invoice_number.trim(),
      p_site_conditions: form.site_conditions.trim() || null,
      p_notes: form.notes.trim() || null,
    }),
    'The job could not be saved.',
  )

  if (error) return { error }

  return { message: describeSave(data) }
}

// What changed on the shelf, in a sentence. A job with no date claims nothing
// by rule, and saying "its parts are claimed" about one would be a lie that
// reads as reassurance.
function describeSave(result) {
  const unresolved = Number(result?.unresolved_lines) || 0
  const lines = Number(result?.open_lines) || 0
  const units = Number(result?.units_committed) || 0
  const claimed = result?.claimed === true

  const still = unresolved > 0
    ? ` ${unresolved} ${unresolved === 1 ? 'line' : 'lines'} on its parts list still `
      + `${unresolved === 1 ? 'has' : 'have'} no matching item, so ${unresolved === 1 ? 'it is' : 'they are'} `
      + 'not counted and installing will be refused until that is fixed.'
    : ''

  if (!claimed) {
    return `Saved.${still || ' It has no date, so it claims no parts yet.'}`
  }

  if (lines === 0) {
    return `Saved. It claims nothing from the shelf.${still}`
  }

  return `Saved. It now claims ${lines} ${lines === 1 ? 'part' : 'parts'}, `
    + `${units} ${units === 1 ? 'unit' : 'units'} in all.${still}`
}
