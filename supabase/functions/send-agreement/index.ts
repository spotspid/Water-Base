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

  let body: {
    job_id?: string
    type?: string
    inspect?: boolean
    submission_id?: string
    archive?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return fail('The request body was not valid JSON.', 400)
  }

  // Reading back a submission that already exists. Needs nothing but an id, so
  // it answers before any of the job gathering below. Read only: it exists
  // because "what did DocuSeal actually store" is a question that cannot be
  // answered from this side any other way, the API key being a secret.
  const readBackId = String(body.submission_id || '').trim()

  if (readBackId) {
    // DELETE archives rather than deletes: DocuSeal records archived_at and
    // keeps the document and its audit log. That is what makes it safe to do
    // to a superseded submission, and reversible if the wrong one goes.
    const archiving = body.archive === true

    try {
      const res = await fetch(
        `${DOCUSEAL_API}/submissions/${encodeURIComponent(readBackId)}`,
        {
          method: archiving ? 'DELETE' : 'GET',
          headers: { 'X-Auth-Token': apiKey },
        },
      )

      const payload = await res.json().catch(() => null)

      if (!res.ok) {
        return fail(`DocuSeal returned ${res.status} for submission ${readBackId}.`, 502,
          { detail: payload })
      }

      return json({ ok: true, archived: archiving, submission: payload })
    } catch (caught) {
      return fail(`DocuSeal could not be reached. ${(caught as Error).message}`, 502)
    }
  }

  const jobId = String(body.job_id || '').trim()
  const type = String(body.type || 'customer_install').trim()

  // A dry run. Gathers everything, reads the template, matches the field names
  // and reports what would be sent, without creating a submission or writing a
  // row. Exists because the only other way to learn a template's real field
  // names was to email a real person and see what came out, and because a
  // template can be renamed in DocuSeal by somebody who has never seen this
  // code.
  const inspectOnly = body.inspect === true

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

    // No pay, no document.
    //
    // A work order carries an agreed_pay box. Sending one with that box empty
    // puts a subcontractor's signature on an agreement to work for an amount
    // nobody wrote down, which is worse than sending nothing at all: there is
    // no document to argue about, and there is a signature saying there was.
    //
    // job_margin coalesces a null payout to zero, so a job nobody has priced
    // and a job priced at nothing look identical here. Both are refused, for
    // the same reason.
    const payout = Number(job.installer_pay)

    if (!Number.isFinite(payout) || payout <= 0) {
      return fail(
        `${String(crew.name || 'That installer')} has no payout on this job, so the agreed pay `
        + 'on the work order would be blank. Enter the payout on the job and send it again.',
        422,
        { job_id: jobId, customer_name: job.customer_name ?? null, installer_pay: job.installer_pay },
      )
    }
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
  let template: {
    name?: string
    fields?: Array<{ name?: string; submitter_uuid?: string; type?: string }>
    submitters?: Array<{ name?: string; uuid?: string }>
  }
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

  // A dry run against a template with nothing usable on it still has to say
  // what DocuSeal sent, because "no named fields" is the answer that most
  // needs looking at and the least useful on its own.
  if (inspectOnly && templateFieldNames.length === 0) {
    const raw = template as Record<string, unknown>
    return json({
      ok: false,
      inspect: true,
      type,
      template_id: templateId,
      template_name: raw.name ?? null,
      problem: 'The template carries no named fields.',
      response_keys: Object.keys(raw),
      field_count: Array.isArray(raw.fields) ? raw.fields.length : null,
      raw_fields: Array.isArray(raw.fields) ? raw.fields.slice(0, 40) : raw.fields ?? null,
      submitters: raw.submitters ?? null,
      documents: Array.isArray(raw.documents)
        ? (raw.documents as Array<Record<string, unknown>>).map(d => d?.name ?? null)
        : null,
    })
  }

  if (templateFieldNames.length === 0) {
    return fail(
      `DocuSeal template ${templateId} has no named fields, so nothing can be prefilled. `
      + 'Add field names to the template in DocuSeal.',
      422,
    )
  }

  const { fields, missing, filled, openToSigner } = matchFields(spec, templateFieldNames, ctx)

  // Which role to attach the submitter to.
  //
  // A template names its own roles, and sending one it has never heard of does
  // not fail: DocuSeal quietly files the submitter under whichever role comes
  // next, which is how a work order addressed to "Subcontractor" arrived as
  // "Second Party". Prefer the spec's name when the template has it, otherwise
  // take the template's own first role and say so.
  const templateRoles = (template.submitters || [])
    .map(r => String(r?.name || ''))
    .filter(Boolean)

  // Which role owns how many boxes. This is the part that matters: a submitter
  // attached to a role that owns nothing sees an empty document, which looks
  // identical to a prefill that silently failed. Template 5532104 keeps every
  // field on First Party and has a Second Party that owns none, so picking the
  // template's first role would be exactly wrong.
  const fieldsPerRole = new Map<string, number>()
  for (const field of template.fields || []) {
    const owner = (template.submitters || [])
      .find(r => r?.uuid === field?.submitter_uuid)?.name
    if (owner) fieldsPerRole.set(owner, (fieldsPerRole.get(owner) ?? 0) + 1)
  }

  const busiestRole = [...fieldsPerRole.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0]

  // Prefer the name the spec asks for, but only if it actually owns boxes.
  // Otherwise go where the fields are.
  const submitterRole = (fieldsPerRole.get(spec.submitterRole) ?? 0) > 0
    ? spec.submitterRole
    : (busiestRole || templateRoles[0] || spec.submitterRole)

  // What actually prefills a field, per the API reference: values is an object
  // keyed by field name. The fields array beside it is configuration, which is
  // where readonly belongs, and it is nested inside the submitter rather than
  // sitting at the top level of the request.
  const values: Record<string, string> = {}
  for (const field of fields) {
    if (field.default_value !== '') values[field.name] = field.default_value
  }

  const fieldConfig = fields.map(f => ({ name: f.name, readonly: f.readonly }))

  // Everything above this line is a read. A dry run stops here, so it can be
  // pointed at a live job without risk of an email leaving the building.
  if (inspectOnly) {
    return json({
      ok: missing.length === 0,
      inspect: true,
      type,
      template_id: templateId,
      template_name: template.name || null,
      template_fields: templateFieldNames,
      template_roles: templateRoles,
      // Which role owns each box. A submitter attached to the wrong role sees
      // none of these, which looks exactly like a prefill that did not work.
      field_owners: (template.fields || []).map(f => ({
        name: f?.name ?? null,
        type: f?.type ?? null,
        role: (template.submitters || [])
          .find(r => r?.uuid === f?.submitter_uuid)?.name ?? null,
      })),
      // the role the submitter will actually be filed under, which is not
      // always the one the spec asks for
      submitter_role: submitterRole,
      role_matched: templateRoles.includes(spec.submitterRole),
      fields_per_role: Object.fromEntries(fieldsPerRole),
      would_send_to: email,
      // what the spec wanted but the template does not offer
      missing,
      // A spec field can fail to reach the document for two unrelated reasons,
      // and reporting them as one list sends you looking for a missing box
      // that is actually there. Split on purpose.
      //
      //   no box       the template has nothing by any of the names tried,
      //                which is a template to fix
      //   no value     the box exists and this job had nothing to put in it,
      //                which is usually correct and needs nothing
      no_box_on_template: spec.fields
        .filter(f => !f.names.some(n => templateFieldNames.includes(n)))
        .map(f => `${f.key} (looked for ${f.names.join(', ')})`),
      skipped_no_value: spec.fields
        .filter(f => f.names.some(n => templateFieldNames.includes(n)))
        .filter(f => !fields.some(sent => f.names.includes(sent.name)))
        .map(f => f.key),
      // template boxes nothing in the spec claims
      unclaimed_template_fields: templateFieldNames
        .filter(name => !fields.some(sent => sent.name === name)),
      // DocuSeal allows two boxes to share a name. They then take the same
      // value, which is usually what a signature repeated on two pages wants,
      // but it is worth seeing rather than discovering.
      duplicate_template_names: templateFieldNames
        .filter((n, i) => templateFieldNames.indexOf(n) !== i),
      left_for_signer: openToSigner,
      would_fill: fields.map(f => ({
        name: f.name,
        value: f.default_value,
        readonly: f.readonly,
      })),
      parts_listed: parts.length,
    })
  }

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
      // Both halves go inside the submitter, and they do different jobs.
      //
      //   values  what the field says. An object keyed by field name.
      //   fields  how the field behaves. This is where readonly lives.
      //
      // An earlier version put a fields array at the top level of the request
      // with the values in default_value. DocuSeal accepted that request, sent
      // the email and stored values: [], so the document arrived completely
      // blank and nothing anywhere reported a problem. Silence is the failure
      // mode here, which is why the read back exists.
      body: JSON.stringify({
        template_id: Number(templateId) || templateId,
        send_email: true,
        submitters: [{
          role: submitterRole,
          email,
          name: spec.submitterName(ctx),
          values,
          fields: fieldConfig,
        }],
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
    submitter_role: submitterRole,
    fields_prefilled: filled,
    values_sent: Object.keys(values).length,
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
