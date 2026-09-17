// Looking one customer up in GoHighLevel.
//
// Read only, like everything else in this function. Every call below is a GET,
// and nothing here writes to GHL or to Water Base.
//
// Given an email or a phone, it finds the contact and returns what a person
// would scroll through in the CRM to answer "when is this install": the
// conversation messages, the appointments, the notes, and the opportunities
// with their custom fields named rather than left as ids.
//
// Each section is fetched on its own and fails on its own. A token without
// the conversations scope still returns the opportunities, and the section it
// could not read says why, rather than one refusal emptying the whole answer.

import { Api, get, str } from './ghl.ts'

// Caps, so one chatty contact cannot run this until the platform kills it.
const MAX_CONTACTS = 5
const MAX_CONVERSATIONS = 10
const MAX_MESSAGE_PAGES = 10

type Section<T> = { items: T[]; error: string }

export type LookupInput = { email?: unknown; phone?: unknown }

function digits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

// A US number in the form GHL stores, so a search for (248) 872-0730 finds
// +12488720730.
function e164(value: unknown): string {
  const d = digits(value)
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return d ? `+${d}` : ''
}

// Email bodies arrive as HTML. Enough is stripped to quote them, not to
// render them.
function plain(value: unknown): string | null {
  const s = str(value)
  if (!s) return null
  return s
    .replace(/<(br|\/p|\/div)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// GHL stores a custom field's value under a different key per data type.
function fieldValue(raw: Record<string, unknown>): unknown {
  for (const key of ['fieldValue', 'value', 'fieldValueString', 'fieldValueDate', 'fieldValueNumber',
    'fieldValueArray', 'fieldValueBoolean']) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') return raw[key]
  }
  return null
}

async function section<T>(
  api: Api, key: string, path: string, pick: (body: Record<string, unknown>) => T[],
): Promise<Section<T>> {
  const res = await get(api, key, path)
  if (!res.ok) return { items: [], error: res.error || `GHL answered ${res.status}.` }
  try {
    return { items: pick(res.body ?? {}), error: '' }
  } catch (caught) {
    return { items: [], error: `GHL answered in a shape this does not read. ${(caught as Error).message}` }
  }
}

async function findContacts(
  api: Api, key: string, locationId: string, email: string, phone: string,
): Promise<Section<Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>()
  const errors: string[] = []

  for (const query of [email, phone].filter(Boolean)) {
    const res = await section(api, key,
      `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(query)}&limit=20`,
      body => (body.contacts ?? []) as Array<Record<string, unknown>>)

    if (res.error) errors.push(`searching ${query}: ${res.error}`)

    for (const contact of res.items) {
      const id = str(contact.id)
      // A text search matches loosely. Only a contact whose own email or phone
      // is the one asked for counts, so a neighbour with a similar number does
      // not get reported as this customer.
      const sameEmail = email && String(contact.email ?? '').toLowerCase() === email
      const samePhone = phone && digits(contact.phone).endsWith(digits(phone).slice(-10))
      if (id && (sameEmail || samePhone)) found.set(id, contact)
    }
  }

  return { items: [...found.values()].slice(0, MAX_CONTACTS), error: errors.join(' ') }
}

async function fieldNames(api: Api, key: string, locationId: string): Promise<Map<string, string>> {
  const res = await section(api, key,
    `/locations/${encodeURIComponent(locationId)}/customFields?model=all`,
    body => (body.customFields ?? []) as Array<Record<string, unknown>>)

  return new Map(res.items
    .map(f => [str(f.id) ?? '', str(f.name) ?? str(f.fieldKey) ?? ''] as [string, string])
    .filter(([id]) => id))
}

function named(raw: unknown, names: Map<string, string>) {
  return ((raw ?? []) as Array<Record<string, unknown>>)
    .map(f => ({ id: str(f.id), name: names.get(str(f.id) ?? '') ?? null, value: fieldValue(f) }))
    .filter(f => f.value !== null)
}

async function messagesFor(
  api: Api, key: string, conversationId: string,
): Promise<Section<Record<string, unknown>>> {
  const out: Record<string, unknown>[] = []
  let cursor = ''

  for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
    const res = await get(api, key,
      `/conversations/${encodeURIComponent(conversationId)}/messages?limit=100${cursor}`)
    if (!res.ok) return { items: out, error: res.error }

    const wrap = (res.body?.messages ?? {}) as Record<string, unknown>
    const rows = (Array.isArray(wrap) ? wrap : (wrap.messages ?? [])) as Array<Record<string, unknown>>

    for (const m of rows) {
      out.push({
        id: str(m.id),
        date: str(m.dateAdded),
        direction: str(m.direction),
        type: str(m.messageType) ?? str(m.type),
        body: plain(m.body),
        attachments: m.attachments ?? [],
      })
    }

    const next = Array.isArray(wrap) ? null : (wrap.nextPage ? str(wrap.lastMessageId) : null)
    if (!next || rows.length === 0) break
    cursor = `&lastMessageId=${encodeURIComponent(next)}`
  }

  return { items: out, error: '' }
}

/**
 * Everything GHL holds on one customer that could name an install date.
 */
export async function lookupContact(
  api: Api, key: string, locationId: string, input: LookupInput,
): Promise<Record<string, unknown>> {
  const email = String(input.email ?? '').trim().toLowerCase()
  const phone = e164(input.phone)

  if (!email && !phone) throw new Error('Give an email or a phone to look up.')
  if (api !== 'v2') {
    throw new Error('This key speaks the v1 API, which has no conversations endpoint to read.')
  }

  const contacts = await findContacts(api, key, locationId, email, phone)
  const names = await fieldNames(api, key, locationId)
  const results: Record<string, unknown>[] = []

  for (const contact of contacts.items) {
    const id = str(contact.id) ?? ''
    const cid = encodeURIComponent(id)

    const opportunities = await section(api, key,
      `/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${cid}&limit=100`,
      body => ((body.opportunities ?? []) as Array<Record<string, unknown>>).map(o => ({
        id: str(o.id), name: str(o.name), status: str(o.status), stage_id: str(o.pipelineStageId),
        monetary_value: o.monetaryValue ?? null, created: str(o.createdAt), updated: str(o.updatedAt),
        custom_fields: named(o.customFields, names),
      })))

    const appointments = await section(api, key, `/contacts/${cid}/appointments`,
      body => ((body.events ?? []) as Array<Record<string, unknown>>).map(e => ({
        id: str(e.id), title: str(e.title), start: str(e.startTime), end: str(e.endTime),
        status: str(e.appointmentStatus), notes: plain(e.notes),
      })))

    const notes = await section(api, key, `/contacts/${cid}/notes`,
      body => ((body.notes ?? []) as Array<Record<string, unknown>>).map(n => ({
        id: str(n.id), date: str(n.dateAdded), body: plain(n.body),
      })))

    const conversations = await section(api, key,
      `/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${cid}&limit=${MAX_CONVERSATIONS}`,
      body => (body.conversations ?? []) as Array<Record<string, unknown>>)

    const threads: Record<string, unknown>[] = []
    for (const conversation of conversations.items.slice(0, MAX_CONVERSATIONS)) {
      const convId = str(conversation.id)
      if (!convId) continue
      const messages = await messagesFor(api, key, convId)
      threads.push({ id: convId, type: str(conversation.type), messages: messages.items, error: messages.error })
    }

    results.push({
      contact: {
        id, name: str(contact.contactName) ?? [str(contact.firstName), str(contact.lastName)].filter(Boolean).join(' '),
        email: str(contact.email), phone: str(contact.phone), added: str(contact.dateAdded),
        // The address as GHL holds it. Read only, like everything here: this
        // is what a job with no city is answered from.
        address1: str(contact.address1) ?? str(contact.address),
        city: str(contact.city),
        postal_code: str(contact.postalCode) ?? str(contact.postal_code),
        state: str(contact.state),
        tags: contact.tags ?? [], custom_fields: named(contact.customFields, names),
      },
      opportunities, appointments, notes,
      conversations: { items: threads, error: conversations.error },
    })
  }

  return { searched: { email: email || null, phone: phone || null }, contacts: results, contact_error: contacts.error }
}
