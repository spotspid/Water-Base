import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { Context, Part, SPECS, matchFields } from './fieldMap.ts'

// send-agreement
//
// Creates a DocuSeal submission for a job and records it against the job.
//
// The API key is an edge function secret and is only ever read here. It must
// not move to the frontend: Vite inlines anything it can reach into the
// bundle, which would publish the key to every visitor.

const DOCUSEAL_API = 'https://api.docuseal.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function fail(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status)
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fail('Use POST.', 405)

  const apiKey = Deno.env.get('DOCUSEAL_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!apiKey) {
    return fail(
      'DOCUSEAL_API_KEY is not set on this project, so no agreement can be sent. '
      + 'Set it with supabase secrets set and try again.',
      500,
    )
  }
  if (!supabaseUrl || !anonKey) {
    return fail('This function is missing its Supabase environment.', 500)
  }

  // the caller's own token, so row level security decides what they can read
  // and an expired session is rejected here rather than deeper in
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return fail('Sign in and try again.', 401)
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    return fail('Your session is not valid any more. Sign in again.', 401)
  }

  let body: { job_id?: string; type?: string }
  try {
    body = await req.json()
  } catch {
    return fail('The request body was not valid JSON.', 400)
  }

  const jobId = String(body.job_id || '').trim()
  const type = String(body.type || 'customer_install').trim()

  if (!jobId) return fail('A job id is required.', 400)

  const spec = SPECS[type]
  if (!spec || spec.fields.length === 0) {
    return fail(`The ${type} agreement has no field map yet, so it cannot be sent.`, 422)
  }

  // ---------------------------------------------------------------------
  // the template id is a setting, not a constant
  // ---------------------------------------------------------------------
  const { data: agreementType, error: typeError } = await supabase
    .from('agreement_types')
    .select('type, label, docuseal_template_id, active')
    .eq('type', type)
    .maybeSingle()

  if (typeError) return fail(`The agreement settings could not be read. ${typeError.message}`, 500)
  if (!agreementType) return fail(`There is no agreement type called ${type}.`, 404)
  if (!agreementType.active) {
    return fail(`${agreementType.label} is turned off. Turn it on in Settings first.`, 422)
  }

  const templateId = String(agreementType.docuseal_template_id || '').trim()
  if (!templateId) {
    return fail(
      `${agreementType.label} has no DocuSeal template id. Paste one on the Settings page first.`,
      422,
    )
  }

  // ---------------------------------------------------------------------
  // the job
  // ---------------------------------------------------------------------
  const { data: job, error: jobError } = await supabase
    .from('job_margin')
    .select('id, customer_name, customer_email, phone, address, city, system_template, '
      + 'template_id, sale_price, invoice_number, faucet_finish, ro_type, install_date, '
      + 'scheduled_date, time_window, installer_id, installer_pay, status, site_conditions, '
      + 'deposits_taken, balance_due')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError) return fail(`That job could not be read. ${jobError.message}`, 500)
  if (!job) return fail('That job does not exist, or you cannot see it.', 404)

  // ---------------------------------------------------------------------
  // whatever else this agreement type needs before its fields can be built
  // ---------------------------------------------------------------------
  let installer: Record<string, unknown> | null = null

  if (spec.needsInstaller) {
    if (!job.installer_id) {
      return fail(
        'No installer is assigned to this job, so there is nobody to send a work order to. '
        + 'Assign one first.',
        422,
      )
    }

    const { data: crew, error: crewError } = await supabase
      .from('installers')
      .select('id, name, email, phone')
      .eq('id', job.installer_id)
      .maybeSingle()

    if (crewError) return fail(`The installer could not be read. ${crewError.message}`, 500)
    if (!crew) return fail('That installer is no longer on the roster.', 404)
    installer = crew
  }

  let parts: Part[] = []

  if (spec.needsParts) {
    if (!job.template_id) {
      return fail(
        `This job has no build sheet, so there is no parts list to put on the work order. `
        + `Pick one on the job first.`,
        422,
      )
    }

    // the same resolver the reservations use, so the sheet the installer reads
    // cannot disagree with what the job is actually holding
    const { data: resolved, error: partsError } = await supabase.rpc('resolve_template_parts', {
      p_template_id: job.template_id,
      p_faucet_finish: job.faucet_finish || null,
      p_ro_type: job.ro_type || null,
    })

    if (partsError) return fail(`The parts list could not be resolved. ${partsError.message}`, 500)

    const rows = (resolved || []) as Array<Record<string, unknown>>
    const unresolved = rows.filter(r => !r.resolved)

    if (unresolved.length > 0) {
      return fail(
        `${unresolved.length} line(s) on this build sheet do not resolve to a stock item for the `
        + `choices on this job, so the work order would list the wrong parts. Set the faucet `
        + `finish and RO type first.`,
        422,
      )
    }

    parts = rows.map(r => ({
      sku: String(r.sku || ''),
      name: String(r.item_name || ''),
      quantity: Number(r.quantity) || 0,
    }))
  }

  const ctx: Context = { job, installer, parts, today: new Date() }

  const email = spec.submitterEmail(ctx)
  if (!email) {
    return fail(
      spec.needsInstaller
        ? `${String(installer?.name || 'That installer')} has no email address on the roster, so `
          + `there is nowhere to send the work order. Add one in Settings.`
        : 'This job has no customer email, so there is nowhere to send the agreement. '
          + 'Add one to the job first.',
      422,
    )
  }

  // ---------------------------------------------------------------------
  // fetch the template and match its field names, rather than assuming them
  // ---------------------------------------------------------------------
  let template: { name?: string; fields?: Array<{ name?: string }> }
  try {
    const res = await fetch(`${DOCUSEAL_API}/templates/${encodeURIComponent(templateId)}`, {
      headers: { 'X-Auth-Token': apiKey },
    })

    if (res.status === 401 || res.status === 403) {
      return fail('DocuSeal rejected the API key. Check DOCUSEAL_API_KEY.', 502)
    }
    if (res.status === 404) {
      return fail(
        `DocuSeal has no template with id ${templateId}. Check the id on the Settings page.`,
        422,
      )
    }
    if (!res.ok) {
      return fail(`DocuSeal returned ${res.status} when reading the template.`, 502)
    }

    template = await res.json()
  } catch (caught) {
    return fail(`DocuSeal could not be reached. ${(caught as Error).message}`, 502)
  }

  const templateFieldNames = (template.fields || [])
    .map(f => String(f?.name || ''))
    .filter(Boolean)

  if (templateFieldNames.length === 0) {
    return fail(
      `DocuSeal template ${templateId} has no named fields, so nothing can be prefilled. `
      + 'Add field names to the template in DocuSeal.',
      422,
    )
  }

  const { fields, missing, filled, openToSigner } = matchFields(spec, templateFieldNames, ctx)

  if (missing.length > 0) {
    return fail(
      `The DocuSeal template does not have the fields this agreement needs: ${missing.join('; ')}.`,
      422,
      { template_fields: templateFieldNames, matched: filled },
    )
  }

  // ---------------------------------------------------------------------
  // create the submission
  // ---------------------------------------------------------------------
  let submission: {
    id?: number | string
    submitters?: Array<{ slug?: string; submission_id?: number | string }>
  } | Array<{ slug?: string; submission_id?: number | string; id?: number | string }>

  try {
    const res = await fetch(`${DOCUSEAL_API}/submissions`, {
      method: 'POST',
      headers: {
        'X-Auth-Token': apiKey,
        'Content-Type': 'application/json',
      },
      // fields is a top level key, not a submitter key. DocuSeal accepts a
      // submitter object carrying one without complaining and then prefills
      // nothing, so putting it in the wrong place fails silently.
      body: JSON.stringify({
        template_id: Number(templateId) || templateId,
        send_email: true,
        submitters: [{
          role: spec.submitterRole,
          email,
          name: spec.submitterName(ctx),
        }],
        fields,
        metadata: { job_id: jobId, agreement_type: type },
      }),
    })

    const payload = await res.json().catch(() => null)

    if (!res.ok) {
      const detail = payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as Record<string, unknown>).error)
        : `HTTP ${res.status}`
      await recordFailure(supabase, jobId, type, detail)
      return fail(`DocuSeal refused the submission. ${detail}`, 502)
    }

    submission = payload
  } catch (caught) {
    const detail = (caught as Error).message
    await recordFailure(supabase, jobId, type, detail)
    return fail(`DocuSeal could not be reached. ${detail}`, 502)
  }

  // the submissions endpoint answers with an array of submitters
  const first = Array.isArray(submission) ? submission[0] : submission?.submitters?.[0]
  const submissionId = String(
    (Array.isArray(submission) ? first?.submission_id : (submission as { id?: unknown }).id)
    ?? first?.submission_id
    ?? '',
  )
  const slug = String(first?.slug || '')

  // ---------------------------------------------------------------------
  // record it. one row per job per type, so a resend updates in place.
  // ---------------------------------------------------------------------
  const { data: existing } = await supabase
    .from('agreements')
    .select('id, send_count')
    .eq('job_id', jobId)
    .eq('type', type)
    .maybeSingle()

  const row = {
    job_id: jobId,
    type,
    docuseal_submission_id: submissionId || null,
    docuseal_slug: slug || null,
    status: 'sent',
    sent_at: new Date().toISOString(),
    completed_at: null,
    signed_document_url: null,
    audit_log_url: null,
    last_error: null,
    send_count: (existing?.send_count ?? 0) + 1,
  }

  const { error: writeError } = await supabase
    .from('agreements')
    .upsert(row, { onConflict: 'job_id,type' })

  if (writeError) {
    return fail(
      'DocuSeal sent the agreement, but it could not be recorded against the job. '
      + `Do not resend, or the customer gets a second email. ${writeError.message}`,
      500,
      { docuseal_submission_id: submissionId },
    )
  }

  return json({
    ok: true,
    submission_id: submissionId,
    slug,
    sent_to: email,
    fields_prefilled: filled,
    left_for_signer: openToSigner,
    parts_listed: parts.length,
    send_count: row.send_count,
  })
})

// Best effort. A failure to record a failure must not mask the original one.
async function recordFailure(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  type: string,
  detail: string,
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('agreements')
      .select('send_count')
      .eq('job_id', jobId)
      .eq('type', type)
      .maybeSingle()

    await supabase.from('agreements').upsert({
      job_id: jobId,
      type,
      status: 'failed',
      last_error: detail.slice(0, 500),
      send_count: existing?.send_count ?? 0,
    }, { onConflict: 'job_id,type' })
  } catch {
    // swallowed on purpose
  }
}
