// The full text history with a customer, as one branded PDF.
//
//   node scripts/text-log.mjs MWP-0027 MWP-0022 MWP-0020
//   node scripts/text-log.mjs MWP-0022 --out "C:/Users/spots/Desktop/logs.pdf"
//
// Takes invoice numbers, looks each job up in Water Base for the email, then
// pulls that contact's whole conversation out of GHL and lays it out as a
// transcript. Several jobs in one run become one document, a customer to a
// page, which is the point: these are read side by side.
//
// Read only. Nothing is written to GHL or to Water Base.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const BRAND = {
  navy: '#1C3651',
  ink: '#16222E',
  teal: '#2C819B',
  mist: '#F2F8FA',
  sky: '#DFF7FC',
  line: '#DCE7EC',
  muted: '#5B6E7B',
}

const COMPANY = {
  name: 'Michigan Water Pros',
  site: 'michiganwaterpros.com',
  logo: 'assets/brand/mwp-logo.webp',
}

function envValue(key) {
  if (process.env[key]) return process.env[key].trim()
  if (!existsSync('.env.local')) return ''
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at > 0 && line.slice(0, at).trim() === key) return line.slice(at + 1).trim()
  }
  return ''
}

const URL_BASE = () => envValue('VITE_SUPABASE_URL')
const KEY = () => envValue('SUPABASE_SERVICE_ROLE_KEY')

const escape = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const money = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

// Eastern, because that is where the business and the customer both are, and a
// transcript that reads in UTC makes an evening text look like the small hours.
const EASTERN = { timeZone: 'America/Detroit' }

const dayOf = iso => new Date(iso).toLocaleDateString('en-US',
  { ...EASTERN, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

const timeOf = iso => new Date(iso).toLocaleTimeString('en-US',
  { ...EASTERN, hour: 'numeric', minute: '2-digit' })

async function job(invoice) {
  const res = await fetch(
    `${URL_BASE()}/rest/v1/jobs?invoice_number=eq.${encodeURIComponent(invoice)}`
    + '&select=customer_name,customer_email,phone,invoice_number,sale_price,status,system_template,sold_at',
    { headers: { apikey: KEY(), Authorization: `Bearer ${KEY()}` } })

  if (!res.ok) throw new Error(`Water Base answered ${res.status}`)
  return (await res.json())[0] || null
}

async function thread(email) {
  const res = await fetch(`${URL_BASE()}/functions/v1/ghl-sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'lookup', email }),
  })

  if (!res.ok) throw new Error(`ghl-sync answered ${res.status}`)

  const found = await res.json()
  const contact = (found.contacts || [])[0]
  if (!contact) return { contact: null, messages: [] }

  const messages = []
  for (const conv of contact.conversations?.items || []) {
    for (const m of conv.messages || []) messages.push(m)
  }

  messages.sort((a, b) => new Date(a.date) - new Date(b.date))
  return { contact: contact.contact, messages }
}

/**
 * One message, or the note that a call happened.
 *
 * Calls carry no transcript here, only that they occurred, and they matter:
 * three of these sales turned on a phone call sitting between two texts, and a
 * log that dropped them would read as though the customer went quiet.
 */
function bubble(m) {
  const inbound = m.direction === 'inbound'
  const body = String(m.body ?? '').trim()
  const kind = String(m.type ?? '')

  if (!body) {
    const what = kind === 'TYPE_CALL' ? 'Phone call' : kind.replace('TYPE_', '').toLowerCase()
    return `<div class="event ${inbound ? 'in' : 'out'}">
      ${escape(timeOf(m.date))} &middot; ${escape(what)} ${inbound ? 'from the customer' : 'to the customer'}
    </div>`
  }

  // A link on its own line is almost always an agreement or an invoice, and
  // reads better named than as sixty characters of query string.
  const text = body.replace(/https?:\/\/\S+/g, url => {
    const what = /docuseal/.test(url) ? 'agreement link'
      : /stripe/.test(url) ? 'invoice link'
        : /survey|review/.test(url) ? 'review request link'
          : 'link'
    return `[${what}]`
  })

  return `<div class="row ${inbound ? 'in' : 'out'}">
    <div class="bub">
      <div class="meta">${inbound ? 'Customer' : 'MWP'} &middot; ${escape(timeOf(m.date))}</div>
      <div class="txt">${escape(text)}</div>
    </div>
  </div>`
}

function transcript(messages) {
  let out = ''
  let currentDay = ''

  for (const m of messages) {
    const d = dayOf(m.date)
    if (d !== currentDay) {
      out += `<div class="day">${escape(d)}</div>`
      currentDay = d
    }
    out += bubble(m)
  }

  return out || '<p class="empty">No conversation was found for this contact in GHL.</p>'
}

function logoTag() {
  if (!existsSync(COMPANY.logo)) return ''
  return `<img class="logo" src="data:image/webp;base64,${readFileSync(COMPANY.logo).toString('base64')}" alt="">`
}

function page(entry) {
  const { job: j, contact, messages } = entry
  const texts = messages.filter(m => String(m.body ?? '').trim()).length
  const calls = messages.filter(m => String(m.type) === 'TYPE_CALL').length
  const first = messages[0]
  const last = messages[messages.length - 1]

  return `<section class="client">
    <div class="who">
      <div>
        <h2>${escape(j.customer_name)}</h2>
        <div class="sub">
          ${escape(j.invoice_number)} &middot; ${escape(j.system_template || '')} &middot; ${money(j.sale_price)}
          &middot; <span class="status">${escape(j.status)}</span>
        </div>
        <div class="sub">
          ${escape(j.phone || contact?.phone || '')}
          ${j.customer_email ? `&middot; ${escape(j.customer_email)}` : ''}
        </div>
      </div>
      <div class="stats">
        <div><b>${texts}</b> messages</div>
        <div><b>${calls}</b> calls</div>
        ${first ? `<div>${escape(dayOf(first.date))}</div>` : ''}
        ${last ? `<div>to ${escape(dayOf(last.date))}</div>` : ''}
      </div>
    </div>
    <div class="thread">${transcript(messages)}</div>
  </section>`
}

function html(entries) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Text logs</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
<style>
  @page { size: Letter; margin: 0.5in 0.6in; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: Inter, system-ui, sans-serif; color: ${BRAND.ink};
    font-size: 9.5pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  header.doc {
    background: ${BRAND.navy}; color: #fff; padding: 22px 26px; margin-bottom: 24px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .logo { height: 38px; display: block; margin-bottom: 8px; }
  header.doc h1 { font-family: Poppins, sans-serif; font-size: 15pt; margin: 0; }
  header.doc .note { font-size: 8.5pt; color: #C8DCE8; margin-top: 4px; }

  .client { break-before: page; }
  .client:first-of-type { break-before: auto; }

  .who {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
    border-bottom: 2px solid ${BRAND.navy}; padding-bottom: 10px; margin-bottom: 16px;
  }
  .who h2 { font-family: Poppins, sans-serif; font-size: 14pt; margin: 0; color: ${BRAND.navy}; }
  .sub { color: ${BRAND.muted}; font-size: 9pt; margin-top: 3px; }
  .status { text-transform: capitalize; }
  .stats { text-align: right; color: ${BRAND.muted}; font-size: 8.5pt; line-height: 1.6; }
  .stats b { color: ${BRAND.ink}; }

  .day {
    text-align: center; font-size: 8pt; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; color: ${BRAND.teal}; margin: 16px 0 10px;
    break-after: avoid;
  }

  .row { display: flex; margin-bottom: 7px; break-inside: avoid; }
  .row.in { justify-content: flex-start; }
  .row.out { justify-content: flex-end; }
  .bub { max-width: 74%; padding: 8px 12px; border-radius: 12px; }
  .row.in .bub { background: ${BRAND.mist}; border: 1px solid ${BRAND.line}; border-bottom-left-radius: 3px; }
  .row.out .bub { background: ${BRAND.sky}; border: 1px solid #BEE6F0; border-bottom-right-radius: 3px; }
  .meta { font-size: 7.5pt; font-weight: 600; color: ${BRAND.muted}; margin-bottom: 2px; }
  .txt { white-space: pre-wrap; }

  .event {
    text-align: center; font-size: 8pt; color: ${BRAND.muted}; font-style: italic;
    margin: 5px 0; break-inside: avoid;
  }
  .empty { color: ${BRAND.muted}; font-style: italic; }
</style></head>
<body>

<header class="doc">
  <div>
    ${logoTag()}
    <h1>Text logs &mdash; ${entries.map(e => escape(e.job.customer_name)).join(', ')}</h1>
    <div class="note">
      Full conversation history from GHL, in Eastern time. Links are named rather than
      printed. Calls are shown where they happened but carry no transcript.
    </div>
  </div>
</header>

${entries.map(page).join('')}

</body></html>`
}

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

function toPdf(htmlPath, pdfPath) {
  const browser = existsSync(EDGE) ? EDGE : existsSync(CHROME) ? CHROME : ''
  if (!browser) throw new Error('Neither Edge nor Chrome was found, and one of them does the printing.')

  execFileSync(browser, [
    '--headless', '--disable-gpu', '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { stdio: 'pipe', timeout: 120000 })
}

async function main() {
  const args = process.argv.slice(2)
  const outAt = args.indexOf('--out')
  const invoices = args.filter((a, i) => !a.startsWith('--') && i !== outAt + 1)

  if (invoices.length === 0) {
    console.error('Which jobs? e.g. node scripts/text-log.mjs MWP-0027 MWP-0022')
    return 1
  }

  const out = resolve(outAt > 0 ? args[outAt + 1] : 'text-logs.pdf')
  const entries = []

  for (const invoice of invoices) {
    const j = await job(invoice)
    if (!j) { console.error(`No job has invoice number ${invoice}.`); return 1 }

    if (!j.customer_email) {
      console.error(`${j.customer_name} has no email on the job, so GHL cannot be searched.`)
      return 1
    }

    const { contact, messages } = await thread(j.customer_email)
    const texts = messages.filter(m => String(m.body ?? '').trim()).length
    console.log(`${j.customer_name.padEnd(18)} ${String(texts).padStart(3)} messages, ${messages.length} entries`)
    entries.push({ job: j, contact, messages })
  }

  const scratch = join(tmpdir(), 'mwp-text-log')
  mkdirSync(scratch, { recursive: true })
  const htmlPath = join(scratch, 'logs.html')
  writeFileSync(htmlPath, html(entries), 'utf8')

  mkdirSync(dirname(out), { recursive: true })
  toPdf(htmlPath, out)

  console.log(out)
  return 0
}

process.exitCode = await main()
