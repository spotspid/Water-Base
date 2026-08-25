// What has to be true before a work order can go to a subcontractor.
//
// Pure and importing nothing, so the repo check can run it. That matters here
// more than usual: this list is the browser's copy of a rule the edge function
// also enforces, and the two have to agree or the button will offer a send
// that the server then refuses.
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
 * Everything that has to be true before a work order can go out, and a plain
 * sentence for whichever one is not.
 *
 * The button reads this rather than disabling itself silently, because a dead
 * button with no reason is worse than no button.
 *
 * Order matters. The checks run cheapest and most obvious first, so somebody
 * who has not scheduled the job is told that rather than being sent to fix a
 * payout on a job that is not happening yet.
 */
export function workOrderBlocker(job) {
  if (!job?.scheduled_date) {
    return 'This job has no date yet, so there is nothing to schedule a crew around.'
  }
  if (!job?.installer_id) {
    return 'No installer is assigned, so there is nobody to send it to.'
  }
  if (!job?.installer_email) {
    return `${job.installer_name || 'That installer'} has no email address on the roster. `
      + 'Add one in Settings.'
  }
  if (!job?.template_id) {
    return 'This job has no build sheet, so there is no parts list to put on the work order.'
  }
  if (agreedPay(job) === null) {
    // The one blocker that is about the document rather than the logistics. A
    // signed work order with no pay on it is worse than no work order: it is
    // an agreement to work for an amount nobody wrote down.
    return 'This job has no installer payout, so the pay on the work order would be blank. '
      + 'Enter the payout on this job first.'
  }
  return ''
}

// Scheduled, crewed, priced, and nothing sent yet. This is the moment to offer.
export function workOrderReady(job, statusOf) {
  return !workOrderBlocker(job) && ['none', 'failed'].includes(statusOf(job))
}
