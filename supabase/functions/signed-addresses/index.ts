import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { signedAddress } from './addressField.ts'

// signed-addresses
//
// Takes the install address off agreements the customer has already signed,
// and puts it on jobs that have none.
//
// A quote can be sent before anybody has been to the house, so the agreement
// carries the address box open and required: the customer types where they
// live, and the signed contract holds it. docuseal-webhook was supposed to
// copy that onto the job as the signature came in and never did, because it
// compared field names exactly against a list written with spaces while the
// box on the template is install_address. Three signed agreements and one out
// for signature went through that gap between 2026-09-30 and 2026-10-24.
//
// The webhook is fixed, which covers everything signed from now on. This
// covers what was already signed, and keeps covering the cases a webhook
// cannot: a document built by hand in DocuSeal, a delivery that failed, a
// signature that arrived while this project was paused.
//
// Read only against DocuSeal. The only thing it writes is jobs.address, only
// onto a blank one, never over an address somebody typed. A customer writes
// the address they would say out loud, so a partial signed version must never
// replace a full office one.
//
// Service role, not a signed-in user, so it can be run from SQL and put on a
// schedule beside the nags.
//
//   { }                     every job with no address, written
//   { "dry": true }         the same, reported and not written
//   { "job_id": "uuid" }    one job

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

type Row = {
  job_id: string
  customer_name: string
  invoice_number: string | null
  submission_id: string
  agreement_status: string
}

type Result = {
  job: string | null
  customer: string
  submission: string
  found: string | null
  wrote: boolean
  note: string
}

/**
 * The address a signer typed, from a whole submission.
 *
 * DocuSeal returns one values list per submitter, and on these templates only
 * the customer has an address box: the company countersigns and the installer
 * signs a different document. So every submitter is read and the first answer
 * wins, rather than guessing which role the customer holds.
 */
function addressFromSubmission(submission: Record<string, unknown>): string {
  const submitters = Array.isArray(submission.submitters)
    ? submission.submitters as Array<Record<string, unknown>>
    : []

  for (const submitter of submitters) {
    const found = signedAddress(submitter.values)
    if (found) return found
  }

  // Some accounts return the completed values on the submission itself.
  return signedAddress((submission as { values?: unknown }).values)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405)

  const apiKey = Deno.env.get('DOCUSEAL_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!apiKey) return json({ error: 'DOCUSEAL_API_KEY is not set on this function.' }, 500)
  if (!supabaseUrl || !serviceKey) return json({ error: 'The function has no Supabase credentials.' }, 500)

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    // an empty body means every job, which is the ordinary run
  }

  const dry = body.dry === true
  const onlyJob = String(body.job_id ?? '').trim()

  const supabase = createClient(supabaseUrl, serviceKey)

  // The agreements worth asking about: a customer agreement that has at least
  // been sent, because an unsent one cannot carry an answer. A quote still out
  // for signature is included, since the customer may have filled the box and
  // not signed, and DocuSeal keeps what they typed.
  //
  // Read in two queries rather than one with an embed. There are two foreign
  // keys called agreements_job_id_fkey, one to public.jobs and one to v2.jobs,
  // so an embed has to name a key that does not uniquely identify itself. Two
  // plain reads and a join here cannot be ambiguous.
  let query = supabase
    .from('agreements')
    .select('job_id, status, docuseal_submission_id')
    .eq('type', 'customer_install')
    .in('status', ['sent', 'completed'])
    .not('docuseal_submission_id', 'is', null)

  if (onlyJob) query = query.eq('job_id', onlyJob)

  const { data: rows, error: readError } = await query

  if (readError) return json({ error: `The agreements could not be read. ${readError.message}` }, 500)

  const agreements = (rows || []) as Array<Record<string, unknown>>
  const jobIds = [...new Set(agreements.map(r => String(r.job_id || '')).filter(Boolean))]

  const candidates: Row[] = []

  if (jobIds.length > 0) {
    const { data: jobRows, error: jobError } = await supabase
      .from('jobs')
      .select('id, customer_name, invoice_number, address')
      .in('id', jobIds)

    if (jobError) return json({ error: `The jobs could not be read. ${jobError.message}` }, 500)

    const byId = new Map<string, Record<string, unknown>>()
    for (const job of (jobRows || []) as Array<Record<string, unknown>>) {
      byId.set(String(job.id), job)
    }

    for (const row of agreements) {
      const job = byId.get(String(row.job_id))
      if (!job) continue
      if (String(job.address ?? '').trim()) continue

      candidates.push({
        job_id: String(row.job_id),
        customer_name: String(job.customer_name ?? ''),
        invoice_number: job.invoice_number ? String(job.invoice_number) : null,
        submission_id: String(row.docuseal_submission_id),
        agreement_status: String(row.status ?? ''),
      })
    }
  }

  const results: Result[] = []

  for (const row of candidates) {
    let found = ''
    let note = ''

    try {
      const res = await fetch(
        `${DOCUSEAL_API}/submissions/${encodeURIComponent(row.submission_id)}`,
        { headers: { 'X-Auth-Token': apiKey } },
      )

      if (res.status === 401 || res.status === 403) {
        return json({ error: 'DocuSeal rejected the API key. Check DOCUSEAL_API_KEY.' }, 502)
      }

      if (!res.ok) {
        note = `DocuSeal answered ${res.status} for submission ${row.submission_id}.`
      } else {
        const payload = (await res.json()) as Record<string, unknown>
        found = addressFromSubmission(payload)
        if (!found) note = 'The signed document has no address in any of its boxes.'
      }
    } catch (caught) {
      note = `DocuSeal could not be reached. ${(caught as Error).message}`
    }

    let wrote = false

    if (found && !dry) {
      // Read the job again rather than trusting the list: a run that takes a
      // minute must not overwrite an address somebody typed during it.
      const { data: fresh, error: freshError } = await supabase
        .from('jobs')
        .select('address')
        .eq('id', row.job_id)
        .maybeSingle()

      if (freshError) {
        note = `The job could not be re-read. ${freshError.message}`
      } else if (String((fresh as Record<string, unknown> | null)?.address ?? '').trim()) {
        note = 'Somebody typed an address while this ran, so the signed one was left alone.'
      } else {
        const { error: writeError } = await supabase
          .from('jobs')
          .update({ address: found })
          .eq('id', row.job_id)

        if (writeError) note = `The address could not be written. ${writeError.message}`
        else {
          wrote = true
          note = 'Taken from the signed agreement.'
        }
      }
    } else if (found && dry) {
      note = 'Would be written.'
    }

    results.push({
      job: row.invoice_number,
      customer: row.customer_name,
      submission: row.submission_id,
      found: found || null,
      wrote,
      note,
    })
  }

  return json({
    ok: true,
    dry,
    looked_at: candidates.length,
    written: results.filter(r => r.wrote).length,
    results,
  })
})
