import { supabase } from './supabase'
import { attempt } from './errors'
import { duplicateKey, parseAmount, parseDate } from './expenses'

// The import is four stages, and only the first one knows what a file is:
//
//   produce   a row producer turns an upload into { columns, rows }
//   map       columns are pointed at spent_on, amount, vendor, description
//   prepare   mapped rows are parsed and validated, then duplicate checked
//   commit    the prepared rows go up as one batch
//
// Stages two through four operate on plain objects and never learn where the
// rows came from. Adding a Claude API PDF extraction later means writing one
// more producer and adding it to PRODUCERS. Nothing below produce() changes,
// and expense_import_batches.source already accepts 'pdf'.

/**
 * A row producer.
 *
 * @typedef  {object}   RowProducer
 * @property {string}   id        matches expense_import_batches.source
 * @property {string}   label     shown on the picker
 * @property {string}   accept    file input accept attribute
 * @property {string}   hint      one line describing what it expects
 * @property {Function} produce   (file) => Promise<{ columns, rows, meta }>
 *                                rows are arrays of plain string keyed objects
 * @property {Function} [suggest] (columns) => partial mapping, best effort
 */

const FIELDS = ['spent_on', 'amount', 'vendor', 'description']

export const FIELD_LABELS = {
  spent_on: 'Date',
  amount: 'Amount',
  vendor: 'Vendor',
  description: 'Description',
}

export const REQUIRED_FIELDS = ['spent_on', 'amount']

export function emptyMapping() {
  return FIELDS.reduce((acc, f) => ({ ...acc, [f]: '' }), {})
}

// Column names an exported statement is likely to use, in preference order.
const HINTS = {
  spent_on: ['date', 'transaction date', 'posted date', 'post date', 'trans date'],
  amount: ['amount', 'debit', 'charge', 'total', 'value'],
  vendor: ['vendor', 'description', 'merchant', 'payee', 'name', 'memo'],
  description: ['memo', 'notes', 'note', 'details', 'description', 'reference'],
}

// Best effort column guess, shared by every producer that has header names.
export function suggestMapping(columns) {
  const mapping = emptyMapping()
  const taken = new Set()
  const normalized = columns.map(c => ({ raw: c, key: String(c).trim().toLowerCase() }))

  for (const field of FIELDS) {
    for (const hint of HINTS[field]) {
      const hit = normalized.find(c => c.key === hint && !taken.has(c.raw))
      if (hit) {
        mapping[field] = hit.raw
        taken.add(hit.raw)
        break
      }
    }
  }

  return mapping
}

/**
 * Stage three. Turns mapped raw rows into rows the database will accept,
 * and collects a per row reason for anything that cannot be used.
 *
 * Rows are never silently dropped. Every input row comes back either in
 * `rows` or in `problems`, so the preview can account for all of them.
 */
export function prepareRows(rawRows, mapping, options = {}) {
  const { category = '', flipSigns = false } = options
  const rows = []
  const problems = []
  const seen = new Map()

  rawRows.forEach((raw, index) => {
    const lineNumber = index + 1
    const spentOn = parseDate(raw[mapping.spent_on])
    const parsed = parseAmount(raw[mapping.amount])
    const amount = parsed == null ? null : (flipSigns ? -parsed : parsed)

    if (!spentOn && amount == null) {
      problems.push({ lineNumber, reason: 'No date and no amount could be read.' })
      return
    }
    if (!spentOn) {
      problems.push({ lineNumber, reason: `Could not read a date from "${raw[mapping.spent_on] ?? ''}".` })
      return
    }
    if (amount == null) {
      problems.push({ lineNumber, reason: `Could not read an amount from "${raw[mapping.amount] ?? ''}".` })
      return
    }
    if (amount === 0) {
      problems.push({ lineNumber, reason: 'Amount is zero, so there is nothing to record.' })
      return
    }

    const row = {
      lineNumber,
      spent_on: spentOn,
      amount,
      vendor: text(raw[mapping.vendor]),
      description: text(raw[mapping.description]),
      category,
      repeatOfLine: null,
    }

    // a file that lists the same charge twice is worth flagging too, not just
    // one that repeats something already saved
    const key = duplicateKey(row)
    if (seen.has(key)) row.repeatOfLine = seen.get(key)
    else seen.set(key, lineNumber)

    rows.push(row)
  })

  return { rows, problems }
}

function text(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

/**
 * Stage three, second half. Asks the database which prepared rows look like
 * expenses that already exist. Flags, never blocks.
 *
 * Returns a Map of array index to { match_count, sample_spent_on }.
 */
export async function findDuplicates(rows) {
  if (rows.length === 0) return { matches: new Map(), error: null }

  const payload = rows.map(r => ({
    spent_on: r.spent_on,
    amount: r.amount,
    vendor: r.vendor || '',
  }))

  const { data, error } = await attempt(
    () => supabase.rpc('expense_duplicate_matches', { p_rows: payload }),
    'The duplicate check could not run.',
  )

  if (error) return { matches: new Map(), error }

  const matches = new Map()
  for (const hit of data || []) {
    matches.set(hit.row_index, {
      matchCount: hit.match_count,
      sampleSpentOn: hit.sample_spent_on,
    })
  }

  return { matches, error: null }
}

/**
 * Stage four. One call, one batch, all or nothing.
 */
export async function commitBatch(sourceId, filename, rows) {
  const payload = rows.map(r => ({
    spent_on: r.spent_on,
    amount: r.amount,
    vendor: r.vendor,
    description: r.description,
    category: r.category,
  }))

  return attempt(
    () => supabase.rpc('commit_expense_batch', {
      p_source: sourceId,
      p_filename: filename || null,
      p_rows: payload,
    }),
    'The import could not be saved.',
  )
}

export async function reverseBatch(batchId) {
  return attempt(
    () => supabase.rpc('reverse_expense_batch', { p_batch_id: batchId }),
    'That import could not be reversed.',
  )
}
