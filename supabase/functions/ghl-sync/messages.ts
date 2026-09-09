// What the reconcile says when the two systems disagree.
//
// Kept apart from the fetching and the posting so the wording can be changed
// without touching the thing that talks to GoHighLevel, and so it stays
// obvious that this file decides nothing: rows in, one string out.
//
// No at-channel. This lands in scheduling beside the morning nag, and a
// mention every time a name is spelled differently in two systems would train
// everyone to mute the room inside a fortnight. The emoji and the bold carry
// it.
//
// The two directions are not the same problem and are not presented as one:
//
//   won in GHL, no job here   the expensive one. A sale closed, no parts are
//                             reserved and nobody is scheduled. It goes first.
//   signed here, not won      a bookkeeping gap. The work is happening; the
//                             CRM just has not been told, so any forecast read
//                             off it is wrong.

export type Row = {
  direction?: unknown
  who?: unknown
  email?: unknown
  amount?: unknown
  detail?: unknown
}

// How many names to print before the list becomes a wall. Beyond this the
// count carries it and the app has the rest.
const MAX_NAMES = 12

function money(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function nameLine(row: Row): string {
  const who = String(row.who || '').trim() || 'Unnamed'
  const email = String(row.email || '').trim()
  const amount = money(row.amount)
  return `• ${who}${email ? ` (${email})` : ''}${amount ? `, ${amount}` : ''}`
}

function section(title: string, rows: Row[]): string[] {
  if (rows.length === 0) return []

  const lines = ['', `*${title}* (${rows.length})`]
  for (const row of rows.slice(0, MAX_NAMES)) lines.push(nameLine(row))
  if (rows.length > MAX_NAMES) lines.push(`• and ${rows.length - MAX_NAMES} more`)

  return lines
}

export function splitDirections(rows: Row[]): { missingJob: Row[]; missingOpportunity: Row[] } {
  return {
    missingJob: rows.filter(r => r.direction === 'opportunity_no_job'),
    missingOpportunity: rows.filter(r => r.direction === 'job_no_opportunity'),
  }
}

/**
 * The whole message, or an empty string when there is nothing to say.
 *
 * Returning empty rather than a cheerful all clear is deliberate: the caller
 * posts only when this has content, and silence is what makes the mornings it
 * does speak worth reading.
 */
export function buildReconcile(rows: Row[], appUrl: string): string {
  if (rows.length === 0) return ''

  const { missingJob, missingOpportunity } = splitDirections(rows)
  const base = String(appUrl || '').replace(/\/+$/, '')

  return [
    `:mag: *GHL and Water Base do not agree* (${rows.length} to look at)`,
    ...section('Won in GHL, no job here', missingJob),
    ...section('Signed here, not won in GHL', missingOpportunity),
    '',
    `<${base}/jobs|Open Jobs>`,
  ].join('\n')
}
