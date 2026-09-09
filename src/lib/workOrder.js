// What has to be true before a work order can go to a subcontractor.
//
// Pure and importing nothing, so the repo check can run it. That matters here
// more than usual: this list is the browser's copy of a rule the edge function
// also enforces, and the two have to agree or the button will offer a send
// that the server then refuses.
//
// One definition, two shapes. The gaps below are the source; workOrderBlocker
// returns the first as a sentence for a button, and workOrderGaps returns all
// of them as short words for a card that has room to say "a crew, a payout and
// a job number" instead of naming one problem three times in a row.
//
// The status vocabulary and the sending live in agreements.js, which needs
// Supabase.

export const WORK_ORDER_TYPE = 'subcontractor_service'

/**
 * The agreed pay on this job, as a number, or null when there is none.
 *
 * job_margin coalesces a null payout to zero, so a job nobody has priced and a
 * job priced at nothing arrive here looking identical. Both are treated as
 * missing, because a work order that tells a subcontractor he is being paid
 * nothing is the same problem as one that tells him nothing at all: he signs
 * it, and then the number is whatever he says it was.
 */
export function agreedPay(job) {
  const n = Number(job?.installer_pay)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Everything that has to be true before a work order can go out.
 *
 * Order matters. The checks run cheapest and most obvious first, so somebody
 * who has not scheduled the job is told that rather than being sent to fix a
 * payout on a job that is not happening yet.
 *
 *   short     for a card listing several at once
 *   sentence  for a button explaining the one thing in the way
 */
const GAPS = [
  {
    key: 'date',
    short: 'a date',
    test: job => !job?.scheduled_date,
    sentence: 'This job has no date yet, so there is nothing to schedule a crew around.',
  },
  {
    key: 'crew',
    short: 'a crew',
    test: job => !job?.installer_id,
    sentence: 'No installer is assigned, so there is nobody to send it to.',
  },
  {
    key: 'crew_email',
    short: 'a crew email',
    test: job => !job?.installer_email,
    sentence: job => `${job?.installer_name || 'That installer'} has no email address on the `
      + 'roster. Add one in Settings.',
  },
  {
    key: 'sheet',
    short: 'a build sheet',
    test: job => !job?.template_id,
    sentence: 'This job has no build sheet, so there is no parts list to put on the work order.',
  },
  {
    // A sheet with no lines resolves cleanly, because nothing to resolve
    // cannot fail. The document would go out reading "No parts list on this
    // build sheet", which looks finished and tells the installer to bring
    // nothing. A refusal is the smaller problem.
    key: 'sheet_parts',
    short: 'parts on its build sheet',
    test: job => (Number(job?.template_line_count) || 0) === 0,
    sentence: job => `The ${job?.system_template || 'build sheet'} sheet has no parts on it, so `
      + 'the work order would tell the installer to bring nothing. Put its parts on the sheet first.',
  },
  {
    // The one gap that is about the document rather than the logistics. A
    // signed work order with no pay on it is worse than no work order: it is
    // an agreement to work for an amount nobody wrote down.
    key: 'payout',
    short: 'a payout',
    test: job => agreedPay(job) === null,
    sentence: 'This job has no installer payout, so the pay on the work order would be blank. '
      + 'Enter the payout on this job first.',
  },
  {
    // job_number is required on DocuSeal template 5532104 and maps to
    // invoice_number. Without it the send returns 422, so a button that looked
    // ready was lying about it.
    key: 'job_number',
    short: 'a job number',
    test: job => !String(job?.invoice_number || '').trim(),
    sentence: 'This job has no invoice number, and the work order document requires one. '
      + 'Add it on the job first.',
  },
]

function sentenceOf(gap, job) {
  return typeof gap.sentence === 'function' ? gap.sentence(job) : gap.sentence
}

/**
 * Every reason this work order cannot go out, in the order they matter.
 *
 * An empty array means it can be sent. Used by anything with room to list
 * them: the today block on the dashboard, and the grouped backlog on
 * Documents.
 */
export function workOrderGaps(job) {
  return GAPS.filter(gap => gap.test(job)).map(gap => ({
    key: gap.key,
    short: gap.short,
    sentence: sentenceOf(gap, job),
  }))
}

/**
 * The one thing standing in the way, as a sentence, or '' when nothing is.
 *
 * The button reads this rather than disabling itself silently, because a dead
 * button with no reason is worse than no button.
 */
export function workOrderBlocker(job) {
  const [first] = workOrderGaps(job)
  return first ? first.sentence : ''
}

/**
 * "a crew, a payout and a job number".
 *
 * Oxford-free on purpose: this is read at a glance on a card, not parsed.
 */
export function gapsSentence(job) {
  const parts = workOrderGaps(job).map(gap => gap.short)

  if (parts.length === 0) return ''
  if (parts.length === 1) return `Needs ${parts[0]}`
  if (parts.length === 2) return `Needs ${parts[0]} and ${parts[1]}`

  return `Needs ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// Scheduled, crewed, priced, and nothing sent yet. This is the moment to offer.
export function workOrderReady(job, statusOf) {
  return !workOrderBlocker(job) && ['none', 'failed'].includes(statusOf(job))
}
