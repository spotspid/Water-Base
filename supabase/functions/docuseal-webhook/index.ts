import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// docuseal-webhook
//
// Public endpoint. Anyone on the internet can POST here, so nothing in the
// body is trusted until the HMAC matches.
//
// This implements DocuSeal's HMAC mode, the whsec_ secret from Security on
// the webhook page. That scheme is not a plain body signature:
//
//   header  X-Docuseal-Signature: <unix seconds>.<hex signature>
//   signed  `${timestamp}.${raw body}`
//   secret  the whsec_ value used verbatim, prefix included
//
// The timestamp is inside the signed string, which is what stops a captured
// request being replayed later: changing it invalidates the signature, and
// keeping it makes the request too old to accept.
//
// DocuSeal gives up after 10 seconds, so this answers 200 as soon as the
// signature checks out and does the database work in the background. A retry
// storm caused by a slow write is worse than a late write.

const REPLAY_TOLERANCE_SECONDS = 300

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

// which events are worth telling anyone about, and as what. form.started is
// deliberately absent: it moves the status but nobody needs a message saying
// somebody has begun reading.
const NOTIFY_AS: Record<string, 'signed' | 'declined' | 'viewed'> = {
  'form.viewed': 'viewed',
  'form.completed': 'signed',
  'form.declined': 'declined',
}

// A view arriving after a signature must not walk the status backwards. The
// link still resolves once the document is done, so an opened event can turn
// up on a completed agreement, and letting it through would un-sign a signed
// contract in the UI.
const OPEN_FROM = ['pending', 'sent', 'opened']

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

type SignatureCheck = { ok: true } | { ok: false; reason: string; status: number }

async function verifySignature(
  secret: string,
  raw: string,
  header: string,
): Promise<SignatureCheck> {
  // split on the first dot only. the signature is hex and the timestamp is
  // digits, so neither half can contain one, but being explicit costs nothing.
  const dot = header.indexOf('.')
  if (dot < 1 || dot === header.length - 1) {
    return { ok: false, reason: 'Signature header is malformed.', status: 401 }
  }

  const timestamp = header.slice(0, dot).trim()
  const provided = header.slice(dot + 1).trim().toLowerCase()

  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) {
    return { ok: false, reason: 'Signature header has no usable timestamp.', status: 401 }
  }

  // a valid signature over an old timestamp is a replay, not a fresh event
  const ageSeconds = Math.abs(Date.now() / 1000 - sentAt)
  if (ageSeconds > REPLAY_TOLERANCE_SECONDS) {
    return {
      ok: false,
      reason: `Signature timestamp is ${Math.round(ageSeconds)} seconds out, outside the ${REPLAY_TOLERANCE_SECONDS} second window.`,
      status: 401,
    }
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  // the signed string is the timestamp, a dot, then the exact bytes received
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${raw}`),
  )

  if (!safeEqual(toHex(signed), provided)) {
    return { ok: false, reason: 'Signature does not match.', status: 401 }
  }

  return { ok: true }
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

  const header = req.headers.get('X-Docuseal-Signature')
    || req.headers.get('x-docuseal-signature')

  if (!header) return reject('Missing signature.', 401)

  // the raw bytes, before any parsing, because that is what was signed.
  // re-serialising the JSON first would change the whitespace and break it.
  const raw = await req.text()

  let check: SignatureCheck
  try {
    check = await verifySignature(secret, raw, header)
  } catch (caught) {
    console.error('signature check failed to run', caught)
    return reject('Signature could not be verified.', 400)
  }

  if (!check.ok) return reject(check.reason, check.status)

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

    if (status === 'opened') query = query.in('status', OPEN_FROM)

    const { data: updated, error } = await query.select('id, job_id, type, status, view_count')

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

    const agreement = updated[0] as Record<string, unknown>
    const agreementId = String(agreement.id || '')
    const intent = NOTIFY_AS[eventType]

    if (!intent || !agreementId) return

    // A view is counted here rather than in the notifier, because counting is
    // a fact about the document and the notifier's job is only to say things.
    // The count comes back so the message can use it without a second read.
    let viewCount: number | undefined

    if (intent === 'viewed') {
      const { data: counted, error: countError } = await supabase
        .rpc('count_agreement_view', { p_agreement_id: agreementId })

      if (countError) {
        console.error('view count failed', { agreementId, countError })
      } else {
        viewCount = Number(counted) || 0
      }
    }

    await tellNotifier(supabaseUrl, serviceKey, {
      mode: 'agreement',
      event: intent,
      agreement_id: agreementId,
      view_count: viewCount,
    })
  } catch (caught) {
    console.error('background handling threw', caught)
  }
}

/**
 * Hands the event to the notifier.
 *
 * This function knows nothing about Slack, channels or webhook URLs, and that
 * is the point: it translates DocuSeal, and one place decides what reaches a
 * human. A failure here is logged and swallowed, because the database write
 * has already succeeded and losing a Slack message is not worth making
 * DocuSeal retry an event that was handled correctly.
 */
async function tellNotifier(
  supabaseUrl: string,
  serviceKey: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body),
    })

    const detail = await res.json().catch(() => null)

    if (!res.ok) {
      console.error('notifier refused the event', { status: res.status, detail })
      return
    }

    console.log('notifier handled the event', detail)
  } catch (caught) {
    console.error('notifier could not be reached', caught)
  }
}
