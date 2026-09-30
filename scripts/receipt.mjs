// A branded receipt for a job, as a PDF.
//
//   node scripts/receipt.mjs MWP-0022
//   node scripts/receipt.mjs MWP-0022 --out C:/some/where.pdf
//
// It reads the job and its recorded payments and prints what it finds. It does
// not accept an amount on the command line, deliberately: a receipt is a
// statement that money was received, and the only safe source for that is the
// payment record. A job with nothing recorded prints as a statement of the
// balance due rather than as a receipt for a payment that may not have
// happened.
//
// Record the payment in Water Base, then run this again.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// Michigan Water Pros, from the site's own stylesheet so the paperwork and the
// website cannot drift apart.
const BRAND = {
  navy: '#1C3651',
  navy2: '#24456A',
  ink: '#16222E',
  teal: '#2C819B',
  tealDeep: '#1F6076',
  mist: '#F2F8FA',
  line: '#DCE7EC',
  muted: '#5B6E7B',
  maroon: '#8C2F2F',
}

const COMPANY = {
  name: 'Michigan Water Pros',
  phone: '(248) 213-7765',
  email: 'contact@michiganwaterpros.com',
  site: 'michiganwaterpros.com',
  // In the repo rather than read from the website checkout, so this prints the
  // same on any machine instead of only on the one where C:\Sites happens to
  // exist. Copied from the site's assets; replace it here if the mark changes.
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

const money = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const day = value => value
  ? new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  : ''

const escape = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

async function rest(path) {
  const url = envValue('VITE_SUPABASE_URL')
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')

  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })

  if (!res.ok) throw new Error(`Supabase answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return await res.json()
}

function logoTag() {
  if (!existsSync(COMPANY.logo)) return ''
  const data = readFileSync(COMPANY.logo).toString('base64')
  return `<img class="logo" src="data:image/webp;base64,${data}" alt="">`
}

/**
 * The document.
 *
 * Two headings, chosen by whether any money is actually recorded. A page that
 * says RECEIPT over a zero is worse than useless: it is a document the
 * customer can hold up as proof of a payment nobody has.
 */
function html(job, payments) {
  const paid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const total = Number(job.sale_price || 0)
  const balance = Math.max(total - paid, 0)
  const isReceipt = paid > 0

  const rows = payments.length > 0
    ? payments.map(p => `
        <tr>
          <td>${escape(day(p.received_on))}</td>
          <td>${escape(p.method || 'Payment')}</td>
          <td class="num">${money(p.amount)}</td>
        </tr>`).join('')
    : `<tr class="none"><td colspan="3">No payment has been recorded against this job.</td></tr>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escape(job.invoice_number)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
<style>
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: Inter, system-ui, sans-serif; color: ${BRAND.ink};
    font-size: 11pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { width: 8.5in; min-height: 11in; padding: 0 0 0.75in; display: flex; flex-direction: column; }

  header {
    background: ${BRAND.navy}; color: #fff; padding: 0.55in 0.75in 0.5in;
    display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
  }
  .logo { height: 54px; width: auto; display: block; margin-bottom: 10px; }
  .co { font-family: Poppins, sans-serif; font-weight: 700; font-size: 17pt; letter-spacing: -0.01em; }
  .contact { font-size: 9pt; color: #C8DCE8; margin-top: 6px; line-height: 1.7; }
  .kind { text-align: right; }
  .kind h1 {
    font-family: Poppins, sans-serif; font-size: 20pt; margin: 0; letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .kind .num { font-size: 10.5pt; color: #C8DCE8; margin-top: 8px; }

  main { padding: 0.5in 0.75in 0; flex: 1; }

  .parties { display: flex; gap: 40px; margin-bottom: 30px; }
  .parties > div { flex: 1; }
  .label {
    font-size: 8pt; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
    color: ${BRAND.teal}; margin-bottom: 7px;
  }
  .who { font-weight: 600; font-size: 12pt; }
  .addr { color: ${BRAND.muted}; font-size: 10pt; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 26px; }
  th {
    text-align: left; font-size: 8pt; font-weight: 600; letter-spacing: 0.1em;
    text-transform: uppercase; color: ${BRAND.teal};
    border-bottom: 2px solid ${BRAND.line}; padding: 0 0 8px;
  }
  td { padding: 11px 0; border-bottom: 1px solid ${BRAND.line}; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .none td { color: ${BRAND.muted}; font-style: italic; }
  .work { font-weight: 500; }
  .work small { display: block; color: ${BRAND.muted}; font-weight: 400; font-style: normal; margin-top: 3px; }

  .totals { margin-left: auto; width: 3.2in; }
  .totals div { display: flex; justify-content: space-between; padding: 7px 0; }
  .totals .rule { border-top: 1px solid ${BRAND.line}; }
  .totals .due {
    border-top: 2px solid ${BRAND.navy}; margin-top: 4px; padding-top: 11px;
    font-family: Poppins, sans-serif; font-weight: 700; font-size: 13pt; color: ${BRAND.navy};
  }
  .totals .due.settled { color: ${BRAND.tealDeep}; }

  .note {
    margin-top: 34px; background: ${BRAND.mist}; border-left: 3px solid ${BRAND.teal};
    padding: 13px 16px; font-size: 9.5pt; color: ${BRAND.muted};
  }
  .note.warn { border-left-color: ${BRAND.maroon}; }

  footer {
    margin-top: auto; padding: 0 0.75in; font-size: 8.5pt; color: ${BRAND.muted};
    display: flex; justify-content: space-between; border-top: 1px solid ${BRAND.line};
    padding-top: 12px; margin-left: 0.75in; margin-right: 0.75in;
  }
</style></head>
<body><div class="sheet">

  <header>
    <div>
      ${logoTag()}
      <div class="co">${escape(COMPANY.name)}</div>
      <div class="contact">
        ${escape(COMPANY.phone)}<br>${escape(COMPANY.email)}<br>${escape(COMPANY.site)}
      </div>
    </div>
    <div class="kind">
      <h1>${isReceipt ? 'Receipt' : 'Statement'}</h1>
      <div class="num">
        ${escape(job.invoice_number || '')}<br>
        ${escape(day(new Date().toISOString()))}
      </div>
    </div>
  </header>

  <main>
    <div class="parties">
      <div>
        <div class="label">Customer</div>
        <div class="who">${escape(job.customer_name)}</div>
        <div class="addr">
          ${escape(job.address || '')}${job.customer_email ? `<br>${escape(job.customer_email)}` : ''}
          ${job.phone ? `<br>${escape(job.phone)}` : ''}
        </div>
      </div>
      <div>
        <div class="label">${job.install_date ? 'Installed' : 'Agreement signed'}</div>
        <div class="who">${escape(day(job.install_date || job.sold_at)) || 'Not scheduled'}</div>
        <div class="addr">${job.installer ? `Installer: ${escape(job.installer)}` : ''}</div>
      </div>
    </div>

    <table>
      <thead><tr><th>Work</th><th></th><th class="num">Amount</th></tr></thead>
      <tbody>
        <tr>
          <td colspan="2" class="work">
            ${escape(job.system_template || 'System')}
            <small>${escape(job.system_long_name || '')}</small>
          </td>
          <td class="num">${money(total)}</td>
        </tr>
      </tbody>
    </table>

    <div class="label">Payments</div>
    <table>
      <thead><tr><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">
      <div><span>Contract total</span><span>${money(total)}</span></div>
      <div class="rule"><span>Paid to date</span><span>${money(paid)}</span></div>
      <div class="due ${balance === 0 ? 'settled' : ''}">
        <span>${balance === 0 ? 'Paid in full' : 'Balance due'}</span>
        <span>${money(balance)}</span>
      </div>
    </div>

    ${isReceipt
      ? `<div class="note">Thank you. ${balance === 0
          ? 'This account is settled in full.'
          : `A balance of ${money(balance)} remains on this job.`}</div>`
      : `<div class="note warn">This is a statement of the balance, not a receipt.
           No payment has been recorded against this job in Water Base, so there is
           nothing to receipt. Once the payment is recorded, this document prints as
           a receipt.</div>`}
  </main>

  <footer>
    <span>${escape(COMPANY.name)} &middot; ${escape(COMPANY.site)}</span>
    <span>${escape(job.invoice_number || '')}</span>
  </footer>

</div></body></html>`
}

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

function toPdf(htmlPath, pdfPath) {
  const browser = existsSync(EDGE) ? EDGE : existsSync(CHROME) ? CHROME : ''
  if (!browser) throw new Error('Neither Edge nor Chrome was found, and one of them does the printing.')

  execFileSync(browser, [
    '--headless',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { stdio: 'pipe', timeout: 60000 })
}

async function main() {
  const invoice = process.argv[2]
  if (!invoice) {
    console.error('Which job? e.g. node scripts/receipt.mjs MWP-0022')
    return 1
  }

  const outFlag = process.argv.indexOf('--out')
  const out = resolve(outFlag > 0 ? process.argv[outFlag + 1] : `${invoice}-receipt.pdf`)

  const jobs = await rest(`jobs?invoice_number=eq.${encodeURIComponent(invoice)}&select=*`)
  if (jobs.length === 0) {
    console.error(`No job has invoice number ${invoice}.`)
    return 1
  }

  const job = jobs[0]
  const payments = await rest(`job_deposits?job_id=eq.${job.id}&select=*&order=received_on.asc`)

  const scratch = join(tmpdir(), 'mwp-receipt')
  mkdirSync(scratch, { recursive: true })
  const htmlPath = join(scratch, `${invoice}.html`)
  writeFileSync(htmlPath, html(job, payments), 'utf8')

  mkdirSync(dirname(out), { recursive: true })
  toPdf(htmlPath, out)

  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  console.log(`${job.customer_name}, ${invoice}: ${payments.length} payment(s), ${money(paid)} of ${money(job.sale_price)}`)
  console.log(paid > 0 ? 'printed as a receipt' : 'printed as a STATEMENT: nothing is recorded as paid')
  console.log(out)
  return 0
}

process.exitCode = await main()
