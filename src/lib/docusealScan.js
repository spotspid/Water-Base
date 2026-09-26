// Which signed documents in DocuSeal are not in Water Base.
//
// DocuSeal is where the paperwork really lives, and for months it was the only
// place: eight signed agreements were built there by hand before this app had
// templates, and nobody knew until the account was read end to end. This is
// that read, kept as a rule so the page can run it whenever somebody asks.
//
// Two gaps, and they are different problems:
//
//   no job here      somebody signed and the job was never written up, so it
//                    is in no schedule, no forecast and no stock reservation
//   not linked here  the job exists and its signed document is not attached,
//                    so the job looks unsigned and the nagging never stops
//
// Everything here is pure: submissions in, rows out. The page fetches, this
// decides, and scripts/check-docuseal.js holds it to the shapes DocuSeal
// actually returns.

// Anything at this address is us, not the person who signed.
const COMPANY_EMAIL = /@michiganwaterpros\.com$/i

// Test sends and the templates themselves, which are not customer paperwork.
const TEST_TITLE = /\b(zz[\s-]*test|test)\b|^(job order template|master - job template)$/i

// A date at the end of a document title, as the job orders carry it:
// "Job Order - Glen Hooker - 9/28/26".
const TITLE_DATE = /(\d{1,2})[/](\d{1,2})[/](\d{2,4})\s*$/

// Only a job order's title date is the day of the work. An installation
// agreement's title carries the day it was written instead.
const WORK_ORDER_TITLE = /job order/i

function clean(value) {
  return String(value ?? '').trim()
}

function normalName(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// First and last word only, so "April Y. Stone" matches "April Stone".
export function nameKey(value) {
  const words = normalName(value).split(' ').filter(word => word.length > 1)
  if (words.length === 0) return ''
  return `${words[0]} ${words[words.length - 1]}`
}

export function documentTitle(submission) {
  return clean(submission?.template?.name) || clean(submission?.name) || 'Untitled document'
}

export function isTestDocument(submission) {
  return TEST_TITLE.test(documentTitle(submission))
}

/**
 * The person who signed, as far as the listing knows.
 *
 * The listing carries submitters but not field values, so a document built by
 * hand names its customer only in the title. Email first, because that is what
 * a job can be matched on; the title's name is the fallback.
 */
export function signerOf(submission) {
  const submitters = Array.isArray(submission?.submitters) ? submission.submitters : []
  const outside = submitters.filter(s => !COMPANY_EMAIL.test(clean(s?.email)))
  const first = outside[0] || submitters[0] || {}

  return {
    email: clean(first.email).toLowerCase(),
    name: clean(first.name) || titleName(documentTitle(submission)),
  }
}

// The customer's name out of a title. The hand written ones vary:
//
//   Job Order - Glen Hooker - 9/28/26
//   Job Order  Bruce Weislik - 9/30/26          (no dash after the kind)
//   Michigan Water Pros Installation Agreement - 9/22/2026 - Bruce Weislik
//
// The kind of document is stripped from each part rather than the part being
// thrown away, because on the second of those the name shares its part with
// the words "Job Order".
const DOCUMENT_KIND = /^(michigan water pros\s*)?(installation agreement|job order|per job work order|service agreement change order|subcontractor agreement|contractor w9)\s*[-:]?\s*/i
const NOT_A_NAME = /^(updated|revised|final|copy|v\d+)$/i

export function titleName(title) {
  const parts = clean(title)
    .split(/\s+-\s+|\s-\s|\s+-\s*|\n/)
    .map(part => clean(part)
      .replace(DOCUMENT_KIND, '')
      .replace(/[()]/g, '')
      // a date inside the part is never part of a name
      .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '')
      .trim())
    .filter(part => part && /[a-z]/i.test(part) && !NOT_A_NAME.test(part)
      && !/michigan water pros|installation agreement|job order|w9|subcontractor/i.test(part))

  return parts.length > 0 ? parts[parts.length - 1] : ''
}

// The day the work is booked for, when the title says so. Two digit years are
// this century: these titles are written by hand and never say 1998.
export function scheduledFromTitle(title) {
  if (!WORK_ORDER_TITLE.test(clean(title))) return ''
  const found = TITLE_DATE.exec(clean(title))
  if (!found) return ''

  const [, month, day, year] = found
  const full = year.length === 2 ? `20${year}` : year
  return `${full}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The gaps between DocuSeal and Water Base.
 *
 * submissions  the DocuSeal listing, live and archived
 * jobs         id, customer_name, customer_email, status, is_test
 * linkedIds    every submission id already on an agreement or in its history
 *
 * Signed documents only. An unsigned one is a quote nobody has accepted, and
 * listing those here would bury the seven that matter under forty that do not.
 */
export function scanGaps({ submissions = [], jobs = [], linkedIds = [] } = {}) {
  const linked = new Set(linkedIds.map(String).filter(Boolean))
  const byEmail = new Map()
  const byName = new Map()

  for (const job of jobs) {
    const email = clean(job.customer_email).toLowerCase()
    if (email) byEmail.set(email, job)
    const key = nameKey(job.customer_name)
    if (key) byName.set(key, job)
  }

  const rows = []
  // The archived listing repeats documents the live one already returned, so
  // the same id arrives twice and would be reported twice.
  const seen = new Set()

  for (const submission of submissions) {
    const id = clean(submission?.id)
    if (!id || linked.has(id) || seen.has(id)) continue
    seen.add(id)
    if (clean(submission?.status) !== 'completed') continue
    if (isTestDocument(submission)) continue

    const title = documentTitle(submission)
    const signer = signerOf(submission)
    const job = byEmail.get(signer.email) || byName.get(nameKey(signer.name)) || null

    rows.push({
      id,
      title,
      signer: signer.name || signer.email || 'Not named',
      signerEmail: signer.email,
      signedAt: clean(submission?.completed_at),
      scheduledDate: scheduledFromTitle(title),
      archived: Boolean(submission?.archived_at),
      jobId: job?.id || '',
      jobName: job ? clean(job.customer_name) : '',
      jobStatus: job ? clean(job.status) : '',
    })
  }

  const newest = (a, b) => String(b.signedAt).localeCompare(String(a.signedAt))

  return {
    missingJobs: rows.filter(row => !row.jobId).sort(newest),
    unlinked: rows.filter(row => row.jobId).sort(newest),
  }
}
