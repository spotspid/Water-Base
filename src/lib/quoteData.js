import { supabaseV2, adoptSession } from './supabaseV2'
import { supabase } from './supabase'
import { whatIsMissing } from './quote'

// Reading and writing a quote.
//
// Apart from quote.js so the arithmetic there imports nothing and can be run
// by a plain Node script. check:quote proves the totals without a browser,
// which is only possible while that file stays free of a database client.

function numberOrNull(value) {
  const text = String(value ?? '').trim()
  if (text === '') return null
  const n = Number(text.replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Save a quote, and its extras with it.
 *
 * Returns { error } or { job }, both already shaped for the page, matching how
 * the rest of the app reports an action.
 *
 * The extras are written after the job because they need its id. A failure
 * part way leaves a job with no extras rather than extras with no job, which
 * is the direction that can be corrected by opening the quote again.
 */
export async function saveQuote(form, orgId, chosenExtras) {
  const missing = whatIsMissing(form)
  if (missing) return { error: missing }

  await adoptSession(supabase)

  const row = {
    org_id: orgId,
    status: 'quoted',
    customer_name: form.customer_name.trim(),
    phone: form.phone.trim() || null,
    customer_email: form.customer_email.trim() || null,
    address: form.address.trim() || null,
    city: form.city.trim() || null,
    water_source: form.water_source || null,
    water_problems: form.water_problems.trim() || null,
    people_in_home: numberOrNull(form.people_in_home),
    bathrooms: numberOrNull(form.bathrooms),
    system_name: form.system_name || null,
    system_description: form.system_description.trim() || null,
    parts_list: form.parts_list.trim() || null,
    faucet_finish: form.faucet_finish || null,
    ro_type: form.ro_type || null,
    valve_type: form.valve_type || null,
    sale_price: numberOrNull(form.sale_price),
    deposit_amount: numberOrNull(form.deposit_amount),
    collected_by: form.collected_by || null,
    site_conditions: form.site_conditions.trim() || null,
    notes: form.notes.trim() || null,
  }

  const { data: job, error } = await supabaseV2
    .from('jobs').insert(row).select('id, customer_name').single()

  if (error) return { error: `The quote could not be saved. ${error.message}` }

  const extras = (chosenExtras || []).map(extra => ({
    org_id: orgId,
    job_id: job.id,
    label: extra.label,
    // Copied, not joined. Changing the price of a reroute next March must not
    // change what a customer agreed to today.
    price: Number(extra.price) || 0,
  }))

  if (extras.length > 0) {
    const { error: extrasError } = await supabaseV2.from('job_extras').insert(extras)

    if (extrasError) {
      return { error: `The quote saved but its extras did not. ${extrasError.message}`, job }
    }
  }

  return { job }
}

export async function loadQuoteSetup() {
  await adoptSession(supabase)

  const [orgs, presets, extras] = await Promise.all([
    supabaseV2.from('organizations').select('id, name').limit(1),
    supabaseV2.from('system_presets').select('*').eq('active', true).order('sort_order'),
    supabaseV2.from('extras').select('*').eq('active', true).order('sort_order'),
  ])

  const firstError = orgs.error || presets.error || extras.error

  if (firstError) {
    return { error: `The quoting page could not load. ${firstError.message}` }
  }

  if (!orgs.data?.length) {
    return { error: 'You do not belong to a company yet, so there is nothing to quote against.' }
  }

  return {
    org: orgs.data[0],
    presets: presets.data || [],
    extras: extras.data || [],
  }
}
