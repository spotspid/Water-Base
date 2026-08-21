import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// docuseal-webhook
//
// Public endpoint. Anyone on the internet can POST here, so nothing in the
// body is trusted until the HMAC over the raw bytes matches.
//
// DocuSeal gives up after 10 seconds, so this answers 200 as soon as the
// signature checks out and does the database work in the background. A
// retry storm caused by a slow write is worse than a late write.

type WebhookEvent = {
  event_type?: string
  timestamp?: string
  data?: Record<string, unknown>
}

// event name to the status stored on the agreement. anything not listed is
// acknowledged and ignored, because DocuSeal adds events over time and an
// unknown one is not an error on our side.
const STATUS_BY_EVENT: Record<string, string> = {
  'form.viewed': 'opened',
  'form.started': 'opened',
  'form.completed': 'completed',
  'form.declined': 'declined',
  'submission.expired': 'expired',
}

function ok(body: Record<string, unknown> = { received: true }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function reject(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Length independent, value independent comparison. A plain === on strings
// leaks how much of the signature was right through timing.
function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  const length = Math.max(left.length, right.length)
  let diff = left.length ^ right.length

  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }

  return diff === 0
}

async function signatureMatches(secret: string, raw: string, provided: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const expected = toHex(signed)

  // some senders prefix the algorithm, so accept both shapes
  const candidate = provided.startsWith('sha256=') ? provided.slice(7) : provided

  return safeEqual(expected, candidate.trim().toLowerCase())
}

Deno.serve(async req => {
  if (req.method !== 'POST') return reject('Use POST.', 405)

  const secret = Deno.env.get('DOCUSEAL_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!secret || !supabaseUrl || !serviceKey) {
    // deliberately vague to the caller, specific in the logs
    console.error('docuseal-webhook is missing configuration', {
      hasSecret: Boolean(secret),
      hasUrl: Boolean(supabaseUrl),
      hasServiceKey: Boolean(serviceKey),
    })
    return reject('This endpoint is not configured.', 500)
  }

  const provided = req.headers.get('X-Docuseal-Signature')
    || req.headers.get('x-docuseal-signature')

  if (!provided) return reject('Missing signature.', 401)

  // the raw bytes, before any parsing, because that is what was signed
  const raw = await req.text()

  let verified = false
  try {
    verified = await signatureMatches(secret, raw, provided)
  } catch (caught) {
    console.error('signature check failed to run', caught)
    return reject('Signature could not be verified.', 400)
  }

  if (!verified) return reject('Signature does not match.', 401)

  let event: WebhookEvent
  try {
    event = JSON.parse(raw)
  } catch {
    return reject('Body was not valid JSON.', 400)
  }

  const eventType = String(event.event_type || '')
  const status = STATUS_BY_EVENT[eventType]

  if (!status) {
    // acknowledged, not an error. an unrecognised event is DocuSeal telling
    // us about something we have no opinion on.
    return ok({ received: true, ignored: eventType || 'unknown' })
  }

  // answer now, write after. DocuSeal times out at 10 seconds and retries.
  const work = handleEvent(supabaseUrl, serviceKey, eventType, status, event)

  if (typeof EdgeRuntime !== 'undefined' && 'waitUntil' in EdgeRuntime) {
    ;(EdgeRuntime as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(work)
  } else {
    work.catch(caught => console.error('background handling failed', caught))
  }

  return ok({ received: true, event: eventType })
})

async function handleEvent(
  supabaseUrl: string,
  serviceKey: string,
  eventType: string,
  status: string,
  event: WebhookEvent,
): Promise<void> {
  try {
    // service role, because a webhook carries no user session and the row it
    // updates belongs to nobody in particular
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const data = event.data || {}
    const submission = (data.submission || {}) as Record<string, unknown>
    const metadata = (data.metadata || submission.metadata || {}) as Record<string, unknown>

    const submissionId = String(data.submission_id ?? submission.id ?? '')
    const jobId = String(metadata.job_id || '')
    const agreementType = String(metadata.agreement_type || 'customer_install')

    if (!submissionId && !jobId) {
      console.error('webhook carried neither a submission id nor a job id', { eventType })
      return
    }

    const documents = Array.isArray(data.documents) ? data.documents as Array<Record<string, unknown>> : []
    const signedUrl = documents.length > 0 ? String(documents[0]?.url || '') : ''
    const auditUrl = String(data.audit_log_url || submission.audit_log_url || '')

    const patch: Record<string, unknown> = { status }

    if (status === 'completed') {
      patch.completed_at = String(data.completed_at || event.timestamp || new Date().toISOString())
      if (signedUrl) patch.signed_document_url = signedUrl
      if (auditUrl) patch.audit_log_url = auditUrl
    }

    // prefer the submission id, because a resend gives the job a new one and
    // the id is what identifies the envelope this event is actually about
    let query = supabase.from('agreements').update(patch)
    query = submissionId
      ? query.eq('docuseal_submission_id', submissionId)
      : query.eq('job_id', jobId).eq('type', agreementType)

    const { data: updated, error } = await query.select('id, job_id, status')

    if (error) {
      console.error('agreement update failed', { eventType, submissionId, jobId, error })
      return
    }

    if (!updated || updated.length === 0) {
      console.error('no agreement matched this event', { eventType, submissionId, jobId })
      return
    }

    // the job columns are kept in step by the agreements_sync_job trigger,
    // so there is nothing more to write here
    console.log('agreement updated', { eventType, status, rows: updated.length })
  } catch (caught) {
    console.error('background handling threw', caught)
  }
}
