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

      // A signature on a document Water Base never sent. There is no agreement
      // row to update and no job to update it against, so nothing above could
      // have worked -- but for a completed or declined document that is a fact
      // somebody needs, not a line in a log.
      //
      // Two real sales were found this way only by scanning DocuSeal by hand:
      // one agreement signed for $899 with no job in Water Base at all, and a
      // used equipment agreement for $2,000 the same. Both were created
      // straight from a DocuSeal template rather than sent from here, so they
      // were invisible until somebody went looking. This is that alert.
      await announceUnmatched(supabase, supabaseUrl, serviceKey, eventType, submissionId, data, submission)
      return
    }

    // the job columns are kept in step by the agreements_sync_job trigger,
    // so there is nothing more to write here
    console.log('agreement updated', { eventType, status, rows: updated.length })

    const agreement = updated[0] as Record<string, unknown>

    // What the customer typed into the agreement, now that they have signed it.
    if (status === 'completed') {
      await absorbSignedAddress(supabase, supabaseUrl, serviceKey, agreement, data, submission)
    }
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

    await tellNotifier(supabase, supabaseUrl, serviceKey, {
      mode: 'agreement',
      event: intent,
      agreement_id: agreementId,
      view_count: viewCount,
    })
  } catch (caught) {
    console.error('background handling threw', caught)
  }
}

// The placeholder a quote saved instead of a blank address, as ADDRESS_TBC in
// src/lib/newJobForm.js and in send-agreement's fieldMap. Repeated rather than
// imported because each function deploys on its own and cannot reach the
// others' files. A job holding it has no address.
const ADDRESS_TBC = 'to be confirmed at a later time'

// What the address box is called on the templates. DocuSeal returns the label
// as it appears on the document, so this is matched loosely.
const ADDRESS_FIELDS = ['address', 'install address', 'installation address', 'service address']

function valuesOf(data: Record<string, unknown>, submission: Record<string, unknown>): Array<Record<string, unknown>> {
  // On form.completed the signer is the event's data. Falling back to the
  // submission's list keeps this working if that shape changes.
  if (Array.isArray(data.values)) return data.values as Array<Record<string, unknown>>

  const submitters = Array.isArray(submission.submitters)
    ? submission.submitters as Array<Record<string, unknown>>
    : []

  for (const s of submitters) {
    if (Array.isArray(s.values) && s.completed_at) return s.values as Array<Record<string, unknown>>
  }

  return []
}

/**
 * Takes the address the customer typed, if the job has none.
 *
 * Only onto a blank. A customer writes the address they would say out loud:
 * the real example that prompted this is "32046 Alameda" against the office's
 * "32046 Alameda Dr, Farmington Hills, MI 48336". Letting the signed version
 * win would quietly make the record worse, and for the legal purpose this
 * exists to serve a partial address is close to useless.
 *
 * So: fill a blank, never overwrite, and say so when the two disagree. The
 * disagreement is the interesting case, and it is the one a human should see
 * rather than a function decide.
 */
async function absorbSignedAddress(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  agreement: Record<string, unknown>,
  data: Record<string, unknown>,
  submission: Record<string, unknown>,
): Promise<void> {
  try {
    // The work order is signed by the installer, who is not the person whose
    // address this is.
    if (String(agreement.type || '') !== 'customer_install') return

    const jobId = String(agreement.job_id || '')
    if (!jobId) return

    const entry = valuesOf(data, submission)
      .find(v => ADDRESS_FIELDS.includes(String(v.field ?? '').trim().toLowerCase()))

    const signed = String(entry?.value ?? '').trim()
    if (!signed) return

    const { data: job, error } = await supabase
      .from('jobs')
      .select('id, address, customer_name')
      .eq('id', jobId)
      .maybeSingle()

    if (error || !job) {
      console.error('could not read the job to compare its address', { jobId, error })
      return
    }

    const current = String((job as Record<string, unknown>).address ?? '').trim()
    const held = current.toLowerCase() === ADDRESS_TBC ? '' : current

    if (!held) {
      const { error: wrote } = await supabase
        .from('jobs')
        .update({ address: signed })
        .eq('id', jobId)

      if (wrote) {
        console.error('could not write the signed address to the job', { jobId, wrote })
        return
      }

      console.log('took the signed address onto a job that had none', { jobId })

      await tellNotifier(supabase, supabaseUrl, serviceKey, {
        mode: 'send',
        channel: 'new_sale',
        event_type: 'docuseal.address_filled',
        message: `${(job as Record<string, unknown>).customer_name} signed with an address, and the job had none.`
          + ` It now reads "${signed}". Check it is complete enough to install from`
          + ` and to hold up: customers often leave off the city and the zip.`,
        dedupe_key: `docuseal.address_filled:${jobId}`,
        job_id: jobId,
        payload: { signed_address: signed },
      })

      return
    }

    // Both exist. Loose comparison, because "Dr" against "Drive" and a missing
    // zip are the same address written twice, and an alert that fires on those
    // is an alert nobody reads.
    const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

    if (loose(held).startsWith(loose(signed)) || loose(signed).startsWith(loose(held))) return

    console.log('the signed address differs from the job', { jobId })

    await tellNotifier(supabase, supabaseUrl, serviceKey, {
      mode: 'send',
      channel: 'new_sale',
      event_type: 'docuseal.address_differs',
      message: `${(job as Record<string, unknown>).customer_name} signed an agreement showing a different address`
        + ` from the job. The job says "${held}". They signed "${signed}". Nothing has been`
        + ` changed, because the signed document is what they agreed to and the job is what`
        + ` the installer drives to. Decide which is right.`,
      dedupe_key: `docuseal.address_differs:${jobId}`,
      job_id: jobId,
      payload: { job_address: held, signed_address: signed },
    })
  } catch (caught) {
    // Never worth failing the event over. The signature is recorded either way.
    console.error('reading the signed address threw', caught)
  }
}

// Only these are worth interrupting somebody for. An unmatched view or expiry
// on a document Water Base never sent is not news: plenty of documents are
// sent from DocuSeal directly and most of them are nothing to do with a job.
// A signature is different, because a signature is money.
const ANNOUNCE_UNMATCHED: Record<string, string> = {
  'form.completed': 'signed',
  'form.declined': 'declined',
}

/**
 * Says out loud that a document was signed which matches nothing here.
 *
 * Deliberately thin on interpretation: it reports who, which submission, and
 * how much if the document happens to carry an amount, then stops. It does not
 * try to find the job by name or create one, because guessing which customer a
 * loose document belongs to is how the wrong job gets the wrong money.
 */
async function announceUnmatched(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  eventType: string,
  submissionId: string,
  data: Record<string, unknown>,
  submission: Record<string, unknown>,
): Promise<void> {
  const what = ANNOUNCE_UNMATCHED[eventType]
  if (!what) return

  // The signer is at the top of data on these events, but fall back to the
  // submission's list so a shape change degrades to a vaguer message rather
  // than to silence.
  const submitters = Array.isArray(submission.submitters)
    ? submission.submitters as Array<Record<string, unknown>>
    : []

  const name = String(data.name || submitters.find(s => s.name)?.name || '').trim()
  const email = String(data.email || submitters.find(s => s.email)?.email || '').trim()
  const who = [name, email].filter(Boolean).join(', ') || 'an unnamed signer'

  // Any field that looks like money, largest first: on these documents the
  // total is the biggest number on the page. Reported as "looks like" because
  // this function cannot know which field is the price.
  const values = Array.isArray(data.values) ? data.values as Array<Record<string, unknown>> : []
  const amounts = values
    .map(v => String(v.value ?? ''))
    .filter(v => /^\$[\d,]+(\.\d{2})?$/.test(v.trim()))
    .sort((a, b) => Number(b.replace(/[$,]/g, '')) - Number(a.replace(/[$,]/g, '')))

  const money = amounts.length > 0 ? ` It shows ${amounts[0]}.` : ''
  const label = String(submission.name || (submission.template as Record<string, unknown>)?.name || '').trim()

  const message = `A document was ${what} in DocuSeal that matches no job in Water Base.`
    + ` ${who}${label ? `, "${label}"` : ''}, submission ${submissionId}.${money}`
    + ` Nothing has been recorded, because this document was not sent from Water Base and`
    + ` there is nothing here to attach it to. Create the job by hand, or re-send it from`
    + ` Water Base so it links itself next time.`

  await tellNotifier(supabase, supabaseUrl, serviceKey, {
    mode: 'send',
    // A signature with no job is a sale nobody has booked, so it goes where
    // sales go rather than to a quiet corner.
    channel: 'new_sale',
    event_type: 'docuseal.unmatched',
    message,
    // Keyed on the submission and the event, so DocuSeal retrying the same
    // signature lands on the same row instead of saying it twice.
    dedupe_key: `docuseal.unmatched:${submissionId}:${eventType}`,
    payload: { submission_id: submissionId, event_type: eventType, signer: email || name },
  })
}

/**
 * Hands the event to the notifier.
 *
 * This function knows nothing about Slack, channels or webhook URLs, and that
 * is the point: it translates DocuSeal, and one place decides what reaches a
 * human.
 *
 * DocuSeal still gets its 200 whatever happens here. The database write has
 * already succeeded and making DocuSeal retry an event that was handled
 * correctly would be worse than a late Slack message.
 *
 * But a failure is no longer only a console line. It writes a failed row
 * carrying the event, so the outbox shows the break and the hourly drain can
 * run it again. The notifier refused every event for weeks with a 403 and the
 * only trace was a log nobody reads, which is a worse fault than the 403.
 */
async function tellNotifier(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  body: Record<string, unknown>,
): Promise<void> {
  let problem = ''

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

    if (res.ok) {
      console.log('notifier handled the event', detail)
      return
    }

    console.error('notifier refused the event', { status: res.status, detail })
    problem = `The notifier answered ${res.status}. `
      + String((detail as Record<string, unknown>)?.error ?? '').slice(0, 200)
  } catch (caught) {
    console.error('notifier could not be reached', caught)
    problem = `The notifier could not be reached. ${(caught as Error)?.message ?? ''}`
  }

  await recordUndelivered(supabase, body, problem)
}

/**
 * Records an event the notifier never got to see.
 *
 * The row carries the event rather than a message, because the message is the
 * notifier's to write and it never ran. The drain reads the retry payload back
 * out and runs the event properly, which is what produces the real message
 * under its own dedupe key.
 *
 * Keyed on the agreement and the intent, so a DocuSeal retry of the same event
 * lands on the same row instead of stacking up failures.
 */
async function recordUndelivered(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  problem: string,
): Promise<void> {
  try {
    const agreementId = String(body.agreement_id ?? '')
    const event = String(body.event ?? body.event_type ?? 'event')

    // An agreement event is identified by its agreement; a plain send carries
    // its own key. Without this every unmatched signature would upsert onto
    // the same row and all but the last would be lost, which is the failure
    // this whole path exists to prevent.
    const key = String(body.dedupe_key ?? '')
      || `notify.undelivered:${agreementId}:${event}`

    const subject = agreementId ? `agreement ${agreementId}` : String(body.message ?? event)

    const { error } = await supabase.from('notifications').upsert({
      event_type: 'notify.undelivered',
      // A label rather than a destination. This row is never posted as it
      // stands: the drain re-runs the event, and the real notification picks
      // its own channel.
      channel: String(body.channel ?? 'scheduling'),
      message: `A ${event} event on ${subject} never reached the notifier.`,
      dedupe_key: `notify.undelivered:${key}`,
      status: 'failed',
      last_error: problem.slice(0, 500),
      payload: { retry: body },
    }, { onConflict: 'dedupe_key' })

    if (error) {
      console.error('could not record the undelivered event', error)
      return
    }

    console.log('recorded an undelivered event for the drain to retry', { agreementId, event })
  } catch (caught) {
    // Last resort. Nothing above this is worth throwing over, because DocuSeal
    // has already been told the event was handled.
    console.error('recording the undelivered event threw', caught)
  }
}
