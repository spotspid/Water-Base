// Talking to GoHighLevel.
//
// Read only. Nothing in this file writes to the CRM, and there is no method
// here that could.
//
// GHL has two live APIs and the credential decides which one you get. A v1
// location key is a JWT against rest.gohighlevel.com; a v2 token is an OAuth
// or Private Integration token against services.leadconnectorhq.com, and it
// wants a Version header the older one has never heard of. GHL_API_KEY is just
// a string in a secret, so rather than guess, this tries v2 and falls back to
// v1 on an auth refusal, and reports which one answered. The alternative is a
// sync that fails at 4am with "401" and no clue which half was wrong.

const V2 = 'https://services.leadconnectorhq.com'
const V1 = 'https://rest.gohighlevel.com/v1'
const V2_VERSION = '2021-07-28'

// A page cap, so a bad cursor cannot spin this function until the platform
// kills it. 40 pages of 100 is far more opportunity than this business has.
const MAX_PAGES = 40
const PAGE_SIZE = 100

export type Api = 'v2' | 'v1'

export type Opportunity = {
  ghl_id: string
  name: string | null
  contact_id: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  pipeline_id: string | null
  pipeline_name: string | null
  stage_id: string | null
  stage_name: string | null
  status: string
  monetary_value: number | null
  ghl_created_at: string | null
  ghl_updated_at: string | null
}

export type Stage = { id: string; name: string; pipelineId: string; pipelineName: string }

function headersFor(api: Api, key: string): Record<string, string> {
  const base: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  }
  if (api === 'v2') base.Version = V2_VERSION
  return base
}

async function get(
  api: Api, key: string, path: string, timeoutMs = 20000,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null; error: string }> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)

  try {
    const res = await fetch(`${api === 'v2' ? V2 : V1}${path}`, {
      headers: headersFor(api, key),
      signal: abort.signal,
    })

    const text = await res.text().catch(() => '')
    let body: Record<string, unknown> | null = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }

    return {
      ok: res.ok,
      status: res.status,
      body,
      // GHL puts the useful part in the body. A bare status says nothing about
      // whether the token is wrong or the location id is.
      error: res.ok ? '' : `${res.status} ${text.slice(0, 200)}`,
    }
  } catch (caught) {
    const err = caught as Error
    if (err?.name === 'AbortError') {
      return { ok: false, status: 0, body: null, error: `GHL did not answer within ${timeoutMs}ms.` }
    }
    return { ok: false, status: 0, body: null, error: `GHL could not be reached. ${err?.message ?? ''}` }
  } finally {
    clearTimeout(timer)
  }
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

function num(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Every stage in the location, keyed by id.
 *
 * The opportunity payload carries a stage id and no stage name, so without
 * this every row would store a uuid where a human expects "Quote Sent". Fetched
 * once per sync rather than per opportunity.
 */
export async function fetchStages(
  api: Api, key: string, locationId: string,
): Promise<{ stages: Map<string, Stage>; error: string }> {
  const path = api === 'v2'
    ? `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`
    : '/pipelines/'

  const res = await get(api, key, path)
  if (!res.ok) return { stages: new Map(), error: res.error }

  const pipelines = (res.body?.pipelines ?? []) as Array<Record<string, unknown>>
  const out = new Map<string, Stage>()

  for (const pipeline of pipelines) {
    const pipelineId = str(pipeline.id) ?? ''
    // Carried through so the hidden pipelines table holds something a human
    // can check, rather than an opaque id nobody can confirm without opening
    // GoHighLevel.
    const pipelineName = str(pipeline.name) ?? ''
    for (const stage of (pipeline.stages ?? []) as Array<Record<string, unknown>>) {
      const id = str(stage.id)
      if (!id) continue
      out.set(id, { id, name: str(stage.name) ?? '', pipelineId, pipelineName })
    }
  }

  return { stages: out, error: '' }
}

// The two APIs disagree on where the contact lives and what the stage field is
// called, and v1 nests the contact while v2 sometimes flattens it. Everything
// below reads both shapes and lands on ours.
function normalise(raw: Record<string, unknown>, stages: Map<string, Stage>): Opportunity | null {
  const id = str(raw.id)
  if (!id) return null

  const contact = (raw.contact ?? {}) as Record<string, unknown>
  const stageId = str(raw.pipelineStageId) ?? str(raw.stageId)
  const stage = stageId ? stages.get(stageId) : undefined

  return {
    ghl_id: id,
    name: str(raw.name),
    contact_id: str(raw.contactId) ?? str(contact.id),
    contact_name: str(contact.name) ?? str(raw.contactName) ?? str(raw.name),
    contact_email: str(contact.email) ?? str(raw.email),
    contact_phone: str(contact.phone) ?? str(raw.phone),
    pipeline_id: str(raw.pipelineId) ?? stage?.pipelineId ?? null,
    pipeline_name: stage?.pipelineName || null,
    stage_id: stageId,
    stage_name: stage?.name ?? null,
    // Never invented. A row with no status would be a row the reconcile cannot
    // reason about, so an absent one is recorded as unknown and stays visible.
    status: (str(raw.status) ?? 'unknown').toLowerCase(),
    monetary_value: num(raw.monetaryValue),
    ghl_created_at: str(raw.createdAt),
    ghl_updated_at: str(raw.updatedAt) ?? str(raw.dateUpdated),
  }
}

/**
 * Every opportunity in the location.
 *
 * v2 has one search endpoint across pipelines. v1 has none, so the pipelines
 * have to be walked one at a time and the results concatenated.
 */
export async function fetchOpportunities(
  api: Api, key: string, locationId: string, stages: Map<string, Stage>,
): Promise<{ opportunities: Opportunity[]; pages: number; error: string }> {
  const out: Opportunity[] = []
  let pages = 0

  const pipelineIds = api === 'v2'
    ? ['']
    : [...new Set([...stages.values()].map(s => s.pipelineId).filter(Boolean))]

  if (api === 'v1' && pipelineIds.length === 0) {
    return { opportunities: [], pages: 0, error: 'No pipelines came back, so there is nothing to read.' }
  }

  for (const pipelineId of pipelineIds) {
    let cursor = ''

    for (let page = 0; page < MAX_PAGES; page++) {
      const path = api === 'v2'
        ? `/opportunities/search?location_id=${encodeURIComponent(locationId)}`
          + `&limit=${PAGE_SIZE}${cursor}`
        : `/pipelines/${encodeURIComponent(pipelineId)}/opportunities?limit=${PAGE_SIZE}${cursor}`

      const res = await get(api, key, path)
      if (!res.ok) return { opportunities: out, pages, error: res.error }

      pages += 1
      const rows = (res.body?.opportunities ?? []) as Array<Record<string, unknown>>

      for (const row of rows) {
        const opportunity = normalise(row, stages)
        if (opportunity) out.push(opportunity)
      }

      if (rows.length < PAGE_SIZE) break

      const meta = (res.body?.meta ?? {}) as Record<string, unknown>
      const startAfterId = str(meta.startAfterId)
      const startAfter = str(meta.startAfter)
      if (!startAfterId) break

      cursor = `&startAfterId=${encodeURIComponent(startAfterId)}`
        + (startAfter ? `&startAfter=${encodeURIComponent(startAfter)}` : '')
    }
  }

  return { opportunities: out, pages, error: '' }
}

/**
 * Which API this credential can actually use.
 *
 * Tries v2, and only treats an auth refusal as a reason to try v1. A 500 from
 * v2 is not evidence that the key is a v1 key, and falling back on it would
 * turn a passing outage into a permanent downgrade.
 */
export async function detectApi(
  key: string, locationId: string,
): Promise<{ api: Api | null; tried: Record<string, string> }> {
  const tried: Record<string, string> = {}

  const v2 = await get('v2', key, `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`)
  tried.v2 = v2.ok ? 'ok' : v2.error
  if (v2.ok) return { api: 'v2', tried }

  if (v2.status === 401 || v2.status === 403 || v2.status === 404) {
    const v1 = await get('v1', key, '/pipelines/')
    tried.v1 = v1.ok ? 'ok' : v1.error
    if (v1.ok) return { api: 'v1', tried }
  }

  return { api: null, tried }
}
