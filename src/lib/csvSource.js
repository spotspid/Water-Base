import { suggestMapping } from './importPipeline'

// The CSV row producer. One implementation of the RowProducer contract in
// importPipeline.js, and currently the only one registered.
//
// A future PDF producer implements the same four properties and returns the
// same { columns, rows } shape. Nothing downstream needs to change.

const MAX_BYTES = 5 * 1024 * 1024

// RFC 4180 enough for real exports: quoted fields, escaped quotes inside
// them, commas and newlines inside quotes, and CRLF or LF line endings.
export function parseCsv(input) {
  const text = String(input).replace(/^﻿/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }

    if (char === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }

    if (char === '\r' || char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += char === '\r' && text[i + 1] === '\n' ? 2 : 1
      continue
    }

    field += char
    i += 1
  }

  // whatever is still buffered is the last row, unless the file ended on a
  // newline and left nothing behind
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter(r => r.some(cell => String(cell).trim() !== ''))
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsText(file)
  })
}

// Duplicate or blank headers make the column picker ambiguous, so they are
// given stable names rather than being rejected.
function headerNames(headerRow) {
  const used = new Map()
  return headerRow.map((raw, index) => {
    const base = String(raw || '').trim() || `Column ${index + 1}`
    const count = used.get(base) || 0
    used.set(base, count + 1)
    return count === 0 ? base : `${base} (${count + 1})`
  })
}

export const csvProducer = {
  id: 'csv',
  label: 'CSV file',
  accept: '.csv,text/csv',
  hint: 'A card or bank export with a header row. Up to 5 MB.',

  async produce(file) {
    if (!file) throw new Error('Pick a file first.')
    if (file.size > MAX_BYTES) {
      throw new Error('That file is over 5 MB. Export a narrower date range and try again.')
    }

    const grid = parseCsv(await readFile(file))

    if (grid.length === 0) throw new Error('That file has no rows in it.')
    if (grid.length === 1) {
      throw new Error('That file has a header row but no transactions under it.')
    }

    const columns = headerNames(grid[0])
    const rows = grid.slice(1).map(cells => {
      const record = {}
      columns.forEach((name, index) => { record[name] = cells[index] ?? '' })
      return record
    })

    return {
      columns,
      rows,
      meta: { filename: file.name, size: file.size },
    }
  },

  suggest: suggestMapping,
}

// The registry the wizard renders from. A PDF producer gets added here.
export const PRODUCERS = [csvProducer]

export function producerById(id) {
  return PRODUCERS.find(p => p.id === id) || null
}
