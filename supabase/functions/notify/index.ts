import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  type Built, type Channel, type JobFacts, type OrderFacts,
  buildDeclined, buildNag, buildOrderArrived, buildSigned, buildViewed,
} from './messages.ts'
import { configuredChannels, postToSlack } from './slack.ts'

// notify
//
// The only thing in the system that talks to Slack. Everything else asks this
// to send, so the three webhook URLs exist in exactly one place and adding a
// caller never means handling a secret again.
//
// Nothing goes out without a row. claim_notification inserts first and returns
// null when the dedupe key is already taken, so the insert is the permission
// to post rather than a note that a post happened. That single rule is what
// makes a DocuSeal retry, a doubled cron run and a manual test all safe.
//
// Service role only. verify_jwt keeps the anonymous internet out, and the role
// check below keeps signed in users out too: a notifier that any logged in
// account could drive is a way to post anything to the company Slack.

const EASTERN_NAG_HOUR = 8

type Body = {
  mode?: string
  // mode 'send'
  event_type?: string
  channel?: string
  message?: string
  dedupe_key?: string
  job_id?: string
  payload?: Record<string, unknown>
  // mode 'nag'
  force?: boolean
  // mode 'agreement'
  event?: string
  agreement_id?: string
  view_count?: number
  // mode 'order'
  order_id?: string
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fail(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status)
}

/**
 * Is this the service role, and not merely a valid caller.
 *
 * verify_jwt at the gateway has already established that whoever is calling
 * holds a real credential for this project, and that includes every signed in
 * user. This asks the narrower question, because a notifier any logged in
 * account could drive is a way to post anything into the company Slack.
 *
 * Two proofs are accepted, because this project has two service role keys in
 * circulation and both are legitimate:
 *
 *   the same value  what Supabase injects into an edge function. The newer
 *                   sb_secret_ format is not a JWT and carries no claims, so
 *                   the only thing to check is that it matches.
 *   a role claim    the legacy JWT format, which Postgres holds in its vault
 *                   and drives the nightly cron with. The gateway has already
 *                   verified its signature, so the claim can be believed.
 *
 * The previous version only did the second, which worked from Postgres and
 * silently refused every call from the DocuSeal webhook: no dots, no payload,
 * no role, a 403 that appeared only in a log nobody reads, and six weeks of
 * events that never reached Slack.
 */
function isServiceRole(header: string, serviceKey: string): boolean {
  const token = header.replace(/^bearer\s+/i, '').trim()
  if (!token) return false

  if (matchesKey(token, serviceKey)) return true

  return roleClaim(token) === 'service_role'
}

// Length first, then constant time, so a wrong key cannot be narrowed down by
// how long the answer takes.
function matchesKey(token: string, serviceKey: string): boolean {
  if (!serviceKey || token.length !== serviceKey.length) return false

  const a = new TextEncoder().encode(token)
  const b = new TextEncoder().encode(serviceKey)
  let diff = 0

  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]

  return diff === 0
}

// The role out of the middle segment of a JWT. Not a signature check, which
// the gateway has already done; it only asks what kind of credential got
// through. Anything that is not a JWT simply has no claim.
function roleClaim(token: string): string {
  try {
    const [, payload] = token.split('.')
    if (!payload) return ''
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(atob(padded + '='.repeat((4 - padded.length % 4) % 4)))
    return String(decoded?.role || '')
  } catch {
    return ''
  }
}

// The calendar day in Eastern, which is the day the nag keys on. Using UTC
// here would roll the key over at 8pm local and let a job be nagged twice in
// one evening.
function easternParts(now: Date): { day: string; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  })

  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]))
  const hour = Number(parts.hour)

  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    // en-CA can render midnight as 24, which would never equal 8 but would
    // read wrong in a log
    hour: hour === 24 ? 0 : hour,
  }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return fail('Use POST.', 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const appUrl = Deno.env.get('APP_URL') || undefined

  if (!supabaseUrl || !serviceKey) {
    console.error('notify is missing its Supabase environment')
    return fail('This function is not configured.', 500)
  }

  const auth = req.headers.get('Authorization') || ''
  if (!isServiceRole(auth, serviceKey)) {
    return fail('This endpoint is for the service role only.', 403)
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return fail('The request body was not valid JSON.', 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const mode = String(body.mode || 'send')

  try {
    if (mode === 'health') {
      return json({ ok: true, channels: configuredChannels(), eastern: easternParts(new Date()) })
    }

    if (mode === 'send') return await handleSend(supabase, body)
    if (mode === 'agreement') return await handleAgreement(supabase, body, appUrl)
    if (mode === 'order') return await handleOrder(supabase, body, appUrl)
    if (mode === 'nag') return await handleNag(supabase, body, appUrl)
    if (mode === 'drain') return await handleDrain(supabase, appUrl)

    return fail(
      `Unknown mode "${mode}". Use agreement, order, send, nag, drain or health.`, 400)
  } catch (caught) {
    console.error('notify threw', caught)
    return fail(`The notifier failed. ${(caught as Error)?.message || String(caught)}`, 500)
  }
})

/**
 * Claims the key, posts, records the outcome.
 *
 * The three steps are the whole contract, and every caller goes through here.
 * A duplicate is a 200 with sent false, not an error, because the calling
 * webhook did nothing wrong by retrying.
 */
async function deliver(
  supabase: ReturnType<typeof createClient>, built: Built,
): Promise<{ sent: boolean; duplicate: boolean; id: string | null; error: string | null }> {
  const { data: claimed, error: claimError } = await supabase.rpc('claim_notification', {
    p_event_type: built.event_type,
    p_channel: built.channel,
    p_message: built.message,
    p_dedupe_key: built.dedupe_key,
    p_job_id: built.job_id || null,
    p_payload: built.payload ?? null,
  })

  if (claimError) {
    console.error('could not claim a notification', { key: built.dedupe_key, claimError })
    return { sent: false, duplicate: false, id: null, error: claimError.message }
  }

  const id = claimed ? String(claimed) : null

  // somebody already holds this key, so this event has been dealt with
  if (!id) return { sent: false, duplicate: true, id: null, error: null }

  const result = await postToSlack(built.channel, built.message)

  if (!result.ok) {
    await supabase.rpc('mark_notification_failed', { p_id: id, p_error: result.error })
    return { sent: false, duplicate: false, id, error: result.error }
  }

  await supabase.rpc('mark_notification_sent', { p_id: id })
  return { sent: true, duplicate: false, id, error: null }
}

async function handleSend(
  supabase: ReturnType<typeof createClient>, body: Body,
): Promise<Response> {
  const channel = String(body.channel || '') as Channel
  const message = String(body.message || '').trim()
  const dedupeKey = String(body.dedupe_key || '').trim()
  const eventType = String(body.event_type || '').trim()

  if (!['new_sale', 'scheduling', 'stock'].includes(channel)) {
    return fail(`"${channel}" is not a channel. Use new_sale, scheduling or stock.`, 400)
  }
  if (!message) return fail('A message is required.', 400)
  if (!dedupeKey) return fail('A dedupe key is required. Nothing sends without one.', 400)
  if (!eventType) return fail('An event type is required.', 400)

  const outcome = await deliver(supabase, {
    channel,
    event_type: eventType,
    message,
    dedupe_key: dedupeKey,
    job_id: String(body.job_id || ''),
    payload: body.payload ?? {},
  })

  if (outcome.error) return json({ ok: false, ...outcome }, 502)
  return json({ ok: true, ...outcome })
}

/**
 * A DocuSeal event, turned into the right message for the right channel.
 *
 * The webhook that receives the event does the database writes, because that
 * is what it is for, and then says what happened in one line. Every decision
 * about wording, loudness and dedupe lives here, so the two never disagree
 * about whether a signature is worth an at-channel.
 */
async function handleAgreement(
  supabase: ReturnType<typeof createClient>, body: Body, appUrl?: string,
): Promise<Response> {
  const agreementId = String(body.agreement_id || '').trim()
  const event = String(body.event || '').trim()

  if (!agreementId) return fail('An agreement id is required.', 400)
  if (!['signed', 'declined', 'viewed'].includes(event)) {
    return fail(`"${event}" is not an agreement event. Use signed, declined or viewed.`, 400)
  }

  const { data: agreement, error: agreementError } = await supabase
    .from('agreements')
    .select('id, job_id, type, view_count')
    .eq('id', agreementId)
    .maybeSingle()

  if (agreementError) {
    return fail(`That agreement could not be read. ${agreementError.message}`, 500)
  }
  if (!agreement) return fail('That agreement does not exist.', 404)

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, customer_name, system_template, sale_price, city')
    .eq('id', agreement.job_id)
    .maybeSingle()

  if (jobError) return fail(`That job could not be read. ${jobError.message}`, 500)
  if (!job) return fail('The job behind that agreement does not exist.', 404)

  const facts = job as JobFacts
  const type = String(agreement.type || 'customer_install')
  const { day } = easternParts(new Date())

  let built: Built
  if (event === 'signed') {
    built = buildSigned(facts, agreementId, type, appUrl)
  } else if (event === 'declined') {
    built = buildDeclined(facts, agreementId, type, appUrl)
  } else {
    const count = Number(body.view_count ?? agreement.view_count) || 0
    built = buildViewed(facts, agreementId, type, count, day, appUrl)
  }

  const outcome = await deliver(supabase, built)

  if (outcome.error) return json({ ok: false, event, ...outcome }, 502)
  return json({ ok: true, event, ...outcome })
}

/**
 * A supplier order landing, to the stock channel.
 *
 * Called by a database trigger the moment the last outstanding line is
 * received, so the message is a consequence of the stock actually existing
 * rather than of anyone remembering to say so. The trigger swallows failures
 * on purpose: a delivery that physically arrived must be recorded whether or
 * not Slack is reachable.
 */
async function handleOrder(
  supabase: ReturnType<typeof createClient>, body: Body, appUrl?: string,
): Promise<Response> {
  const orderId = String(body.order_id || '').trim()
  const event = String(body.event || 'received').trim()

  if (!orderId) return fail('An order id is required.', 400)
  if (event !== 'received') {
    return fail(`"${event}" is not an order event. Only received is handled.`, 400)
  }

  const { data: order, error } = await supabase
    .from('supplier_order_summary')
    .select('id, supplier, order_number, line_count, units_received, order_total')
    .eq('id', orderId)
    .maybeSingle()

  if (error) return fail(`That order could not be read. ${error.message}`, 500)
  if (!order) return fail('That order does not exist.', 404)

  const outcome = await deliver(supabase, buildOrderArrived(order as OrderFacts, appUrl))

  if (outcome.error) return json({ ok: false, event, ...outcome }, 502)
  return json({ ok: true, event, ...outcome })
}

/**
 * The daily sweep.
 *
 * pg_cron fires this at both 12:00 and 13:00 UTC, because 8am Eastern is one
 * or the other depending on daylight saving and pg_cron schedules in UTC. The
 * hour check makes exactly one of those two runs do the work, and the dedupe
 * key would have caught it even if both did.
 */
async function handleNag(
  supabase: ReturnType<typeof createClient>, body: Body, appUrl?: string,
): Promise<Response> {
  const { day, hour } = easternParts(new Date())

  if (!body.force && hour !== EASTERN_NAG_HOUR) {
    return json({
      ok: true,
      skipped: `It is ${hour}:00 in Eastern, not ${EASTERN_NAG_HOUR}:00.`,
      day,
    })
  }

  const { data: rows, error } = await supabase
    .from('nag_candidates')
    .select('*')
    .order('days_until_install', { ascending: true })

  if (error) {
    console.error('nag candidates could not be read', error)
    return fail(`The jobs due a reminder could not be read. ${error.message}`, 500)
  }

  const candidates = rows || []
  const results = { considered: candidates.length, sent: 0, duplicates: 0, failed: 0 }
  const problems: string[] = []

  // Sequential on purpose. A morning sweep is a handful of jobs, Slack rate
  // limits incoming webhooks per channel, and a burst that gets throttled
  // would mark good rows failed.
  for (const row of candidates) {
    const built = buildNag(row as Parameters<typeof buildNag>[0], day, appUrl)
    const outcome = await deliver(supabase, built)

    if (outcome.sent) results.sent += 1
    else if (outcome.duplicate) results.duplicates += 1
    else {
      results.failed += 1
      if (outcome.error) problems.push(outcome.error)
    }
  }

  console.log('daily nag finished', { day, ...results })
  return json({ ok: true, day, ...results, problems: problems.slice(0, 5) })
}

/**
 * Retries anything that has not landed.
 *
 * Two shapes of row end up here, and they need opposite treatment.
 *
 * A row this function claimed and then failed to post already holds the real
 * message and the real dedupe key, so it is simply posted again. It cannot
 * duplicate: the key was claimed on the first attempt and the same row still
 * holds it.
 *
 * A row the webhook wrote because the notifier never ran holds no message at
 * all, only the event. Posting its placeholder text would put a line about
 * plumbing into a channel meant for work. Those are re-run instead, which
 * produces the real notification under its own key, and the placeholder row is
 * marked sent once the event has been dealt with.
 */
async function handleDrain(
  supabase: ReturnType<typeof createClient>, appUrl?: string,
): Promise<Response> {
  const { data: rows, error } = await supabase
    .from('notifications')
    .select('id, channel, message, attempts, payload')
    .neq('status', 'sent')
    .lt('attempts', 5)
    .order('created_at', { ascending: true })
    .limit(25)

  if (error) {
    console.error('pending notifications could not be read', error)
    return fail(`Pending notifications could not be read. ${error.message}`, 500)
  }

  const pending = rows || []
  const results = { pending: pending.length, sent: 0, replayed: 0, failed: 0 }

  for (const row of pending) {
    const retry = (row.payload as Record<string, unknown> | null)?.retry as Body | undefined

    if (retry && typeof retry === 'object' && retry.mode) {
      const outcome = await replay(supabase, retry, appUrl)

      if (outcome.ok) {
        await supabase.rpc('mark_notification_sent', { p_id: row.id })
        results.replayed += 1
      } else {
        await supabase.rpc('mark_notification_failed', { p_id: row.id, p_error: outcome.error })
        results.failed += 1
      }

      continue
    }

    const posted = await postToSlack(row.channel as Channel, String(row.message))

    if (posted.ok) {
      await supabase.rpc('mark_notification_sent', { p_id: row.id })
      results.sent += 1
    } else {
      await supabase.rpc('mark_notification_failed', { p_id: row.id, p_error: posted.error })
      results.failed += 1
    }
  }

  return json({ ok: true, ...results })
}

/**
 * Runs a stored event through the same handler that would have run it live.
 *
 * In process rather than over HTTP: this function is already the notifier, and
 * calling itself through the gateway would only add a way for the retry to be
 * refused the same way the original was.
 */
async function replay(
  supabase: ReturnType<typeof createClient>, retry: Body, appUrl?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const mode = String(retry.mode || '')

    const res = mode === 'agreement'
      ? await handleAgreement(supabase, retry, appUrl)
      : mode === 'order'
        ? await handleOrder(supabase, retry, appUrl)
        : null

    if (!res) return { ok: false, error: `Cannot replay a "${mode}" event.` }

    const detail = await res.json().catch(() => null) as Record<string, unknown> | null

    // A duplicate is a success: it means the event has already been announced,
    // which is exactly what this row was waiting for.
    if (res.ok) return { ok: true }

    return { ok: false, error: String(detail?.error ?? `The replay answered ${res.status}.`) }
  } catch (caught) {
    return { ok: false, error: `The replay threw. ${(caught as Error)?.message ?? ''}` }
  }
}
