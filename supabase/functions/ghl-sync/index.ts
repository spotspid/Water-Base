import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { detectApi, fetchOpportunities, fetchStages } from './ghl.ts'
import { buildReconcile, splitDirections } from './messages.ts'

// ghl-sync
//
// Inbound only. Reads GoHighLevel, writes our own table, and compares the two
// systems overnight. It never writes to the CRM and it never creates a job:
// David writes jobs by hand and this is the check on that, not a replacement
// for it. An integration that quietly created jobs would turn a CRM mistake
// into reserved parts and a scheduled van.
//
// Modes:
//   inspect    probe the credential and report what came back. No writes.
//   sync       pull every opportunity and upsert. Hourly.
//   reconcile  compare both directions and post only if something is off.
//
// Slack is never touched here. The reconcile posts by calling notify, which
// owns the three webhook urls and the outbox, so there is still exactly one
// path to Slack and one place a message can be deduplicated.

const LOCATION_ID = 'ra2NJfCoBWd3gBgHyq0W'
const EASTERN_RECONCILE_HOUR = 3

type Body = { mode?: string; force?: boolean }

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fail(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status)
}

// Same rule as notify: the gateway proves a real credential, this proves it is
// the service role. A sync any signed in user could drive is a way to make the
// CRM picture say whatever you like.
function isServiceRole(header: string, serviceKey: string): boolean {
  const token = header.replace(/^bearer\s+/i, '').trim()
  if (!token) return false
  if (token.length === serviceKey.length && token === serviceKey) return true

  try {
    const [, payload] = token.split('.')
    if (!payload) return false
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(atob(padded + '='.repeat((4 - padded.length % 4) % 4)))
    return String(decoded?.role || '') === 'service_role'
  } catch {
    return false
  }
}

// The Eastern calendar day and hour. The reconcile keys its dedupe on the day,
// so a run at 7 and again at 8 UTC cannot post the same report twice.
function easternParts(now: Date): { day: string; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]))
  const hour = Number(parts.hour)
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: hour === 24 ? 0 : hour }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return fail('Use POST.', 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const ghlKey = Deno.env.get('GHL_API_KEY')
  const appUrl = Deno.env.get('APP_URL') || 'https://water-base.vercel.app'

  if (!supabaseUrl || !serviceKey) {
    console.error('ghl-sync is missing its Supabase environment')
    return fail('This function is not configured.', 500)
  }
  if (!ghlKey) {
    return fail(
      'GHL_API_KEY is not set on this project, so GoHighLevel cannot be read. '
      + 'Set it with supabase secrets set and try again.',
      500,
    )
  }

  if (!isServiceRole(req.headers.get('Authorization') || '', serviceKey)) {
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

  const mode = String(body.mode || 'sync')

  try {
    if (mode === 'inspect') return await handleInspect(ghlKey)
    if (mode === 'sync') return await handleSync(supabase, ghlKey)
    if (mode === 'reconcile') return await handleReconcile(supabase, serviceKey, supabaseUrl, body, appUrl)
    return fail(`Unknown mode "${mode}". Use inspect, sync or reconcile.`, 400)
  } catch (caught) {
    console.error('ghl-sync threw', caught)
    return fail(`The GHL sync failed. ${(caught as Error)?.message || String(caught)}`, 500)
  }
})

/**
 * A dry run against the credential.
 *
 * Exists because "which API does this key speak, and does the location id
 * match it" cannot be answered from our side any other way, and finding out at
 * 4am from a failed cron is the expensive version of asking.
 */
async function handleInspect(ghlKey: string): Promise<Response> {
  const { api, tried } = await detectApi(ghlKey, LOCATION_ID)

  if (!api) {
    return fail('Neither GHL API accepted this key for this location.', 502, {
      location_id: LOCATION_ID, tried,
    })
  }

  const { stages, error: stageError } = await fetchStages(api, ghlKey, LOCATION_ID)
  if (stageError) return fail(`Stages could not be read. ${stageError}`, 502, { api, tried })

  const { opportunities, pages, error } = await fetchOpportunities(api, ghlKey, LOCATION_ID, stages)
  if (error) return fail(`Opportunities could not be read. ${error}`, 502, { api, tried, pages })

  const byStatus: Record<string, number> = {}
  for (const o of opportunities) byStatus[o.status] = (byStatus[o.status] || 0) + 1

  return json({
    ok: true,
    inspect: true,
    api,
    tried,
    location_id: LOCATION_ID,
    pages,
    stages: [...stages.values()].map(s => s.name),
    opportunities: opportunities.length,
    by_status: byStatus,
    // one row, so the shape can be read without dumping the pipeline
    sample: opportunities[0] ?? null,
  })
}

/**
 * Pull everything and write it down.
 *
 * Upsert on the GHL id rather than delete and reload, so a failed page leaves
 * the previous picture in place instead of emptying the table. Rows that
 * disappear from GHL entirely are left behind on purpose: a deleted
 * opportunity is a fact worth still being able to see.
 */
async function handleSync(
  supabase: ReturnType<typeof createClient>, ghlKey: string,
): Promise<Response> {
  const { api, tried } = await detectApi(ghlKey, LOCATION_ID)
  if (!api) return fail('Neither GHL API accepted this key for this location.', 502, { tried })

  const { stages, error: stageError } = await fetchStages(api, ghlKey, LOCATION_ID)
  if (stageError) return fail(`Stages could not be read. ${stageError}`, 502, { api })

  const { opportunities, pages, error } = await fetchOpportunities(api, ghlKey, LOCATION_ID, stages)
  if (error) return fail(`Opportunities could not be read. ${error}`, 502, { api, pages })

  if (opportunities.length === 0) {
    return json({ ok: true, api, pages, synced: 0, note: 'GHL returned no opportunities.' })
  }

  const now = new Date().toISOString()
  const rows = opportunities.map(o => ({ ...o, location_id: LOCATION_ID, synced_at: now }))

  const { error: writeError } = await supabase
    .from('ghl_opportunities')
    .upsert(rows, { onConflict: 'ghl_id' })

  if (writeError) {
    console.error('ghl-sync could not write opportunities', writeError)
    return fail(`The opportunities could not be saved. ${writeError.message}`, 500, { api, pages })
  }

  const byStatus: Record<string, number> = {}
  for (const o of opportunities) byStatus[o.status] = (byStatus[o.status] || 0) + 1

  console.log('ghl-sync finished', { api, pages, synced: rows.length, byStatus })
  return json({ ok: true, api, pages, synced: rows.length, by_status: byStatus, stages: stages.size })
}

/**
 * Compare the two systems, and say nothing when they agree.
 *
 * Silence is the feature. A report that arrives every morning saying "all
 * clear" is a report nobody reads by the second week, and the one morning it
 * says something real it looks the same as the thirty before it.
 */
async function handleReconcile(
  supabase: ReturnType<typeof createClient>,
  serviceKey: string,
  supabaseUrl: string,
  body: Body,
  appUrl: string,
): Promise<Response> {
  const { day, hour } = easternParts(new Date())

  if (!body.force && hour !== EASTERN_RECONCILE_HOUR) {
    return json({ ok: true, skipped: `It is ${hour}:00 in Eastern, not ${EASTERN_RECONCILE_HOUR}:00.`, day })
  }

  const { data, error } = await supabase.rpc('ghl_reconcile')

  if (error) {
    console.error('ghl-sync could not reconcile', error)
    return fail(`The reconcile could not run. ${error.message}`, 500)
  }

  const rows = (data || []) as Array<Record<string, unknown>>

  if (rows.length === 0) {
    console.log('ghl-sync reconcile: everything lines up', { day })
    return json({ ok: true, day, mismatches: 0, posted: false })
  }

  const { missingJob, missingOpportunity } = splitDirections(rows)
  const message = buildReconcile(rows, appUrl)

  // Through notify, always. It holds the webhook urls and the outbox, so this
  // message is deduplicated and retried by the same machinery as every other.
  const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      mode: 'send',
      channel: 'scheduling',
      event_type: 'ghl.reconcile',
      dedupe_key: `ghl.reconcile:${day}`,
      message,
      payload: {
        day,
        missing_job: missingJob.length,
        missing_opportunity: missingOpportunity.length,
      },
    }),
  })

  const detail = await res.json().catch(() => null) as Record<string, unknown> | null

  if (!res.ok) {
    console.error('ghl-sync could not post the reconcile', detail)
    return fail(`The reconcile could not be posted. ${detail?.error ?? res.status}`, 502, {
      day, mismatches: rows.length,
    })
  }

  console.log('ghl-sync reconcile posted', { day, mismatches: rows.length })
  return json({
    ok: true,
    day,
    mismatches: rows.length,
    missing_job: missingJob.length,
    missing_opportunity: missingOpportunity.length,
    posted: true,
    notification: detail,
  })
}
