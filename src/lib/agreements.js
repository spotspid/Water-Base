import { supabase } from './supabase.js'
import { attempt } from './errors.js'

// Agreement state as the UI talks about it.
//
// The status values are the check constraint on agreements.status. A job with
// no agreement row at all reads as 'none', which is not a stored value.

export const AGREEMENT_STATUS_LABELS = {
  none: 'Not sent',
  pending: 'Pending',
  sent: 'Awaiting signature',
  opened: 'Opened',
  completed: 'Signed',
  declined: 'Declined',
  expired: 'Expired',
  failed: 'Send failed',
}

// maps to the status-badge classes already in Jobs.css
export const AGREEMENT_STATUS_TONE = {
  none: 'neutral',
  pending: 'wait',
  sent: 'wait',
  opened: 'wait',
  completed: 'good',
  declined: 'bad',
  expired: 'bad',
  failed: 'bad',
}

export function agreementStatusOf(job) {
  return job?.agreement_status || 'none'
}

export function agreementLabel(job) {
  const status = agreementStatusOf(job)
  return AGREEMENT_STATUS_LABELS[status] || status
}

export function agreementTone(job) {
  return AGREEMENT_STATUS_TONE[agreementStatusOf(job)] || 'neutral'
}

// An agreement that is out but not yet signed is the one a resend applies to.
export function isAwaitingSignature(job) {
  return ['pending', 'sent', 'opened'].includes(agreementStatusOf(job))
}

export function canSendAgreement(job) {
  return !['completed'].includes(agreementStatusOf(job))
}

/**
 * Calls the send-agreement edge function.
 *
 * functions.invoke reports a non 2xx as an error whose body has to be read off
 * the context, and that body is where the useful message lives. Without this
 * unwrapping every failure would read "Edge Function returned a non-2xx status
 * code", which tells an operator nothing about what to fix.
 */
export async function sendAgreement(jobId, type = 'customer_install') {
  try {
    const { data, error } = await supabase.functions.invoke('send-agreement', {
      body: { job_id: jobId, type },
    })

    if (!error) return { data, error: null }

    let message = error.message || 'The agreement could not be sent.'
    let details = null

    try {
      const body = await error.context?.json?.()
      if (body?.error) message = body.error
      if (body?.template_fields) details = body
    } catch {
      // the response had no JSON body, so the generic message stands
    }

    return { data: null, error: message, details }
  } catch (caught) {
    return {
      data: null,
      error: caught?.message || 'The agreement could not be sent. Check your connection.',
      details: null,
    }
  }
}


/* ---------------------------------------------------------------------------
   Work orders.

   Stored as an agreements row of type subcontractor_service, so it shares the
   table, the status vocabulary and the webhook with the customer agreement.
   Only the reader differs: this one goes to the installer, not the customer.
--------------------------------------------------------------------------- */

export const WORK_ORDER_TYPE = 'subcontractor_service'

export function workOrderStatusOf(job) {
  return job?.work_order_status || 'none'
}

export function workOrderLabel(job) {
  const status = workOrderStatusOf(job)
  return AGREEMENT_STATUS_LABELS[status] || status
}

export function workOrderTone(job) {
  return AGREEMENT_STATUS_TONE[workOrderStatusOf(job)] || 'neutral'
}

/**
 * Everything that has to be true before a work order can go out, and a plain
 * sentence for whichever one is not. The button reads this rather than
 * disabling itself silently, because a dead button with no reason is worse
 * than no button.
 */
export function workOrderBlocker(job) {
  if (!job?.scheduled_date) return 'This job has no date yet, so there is nothing to schedule a crew around.'
  if (!job?.installer_id) return 'No installer is assigned, so there is nobody to send it to.'
  if (!job?.installer_email) return `${job.installer_name || 'That installer'} has no email address on the roster. Add one in Settings.`
  if (!job?.template_id) return 'This job has no build sheet, so there is no parts list to put on the work order.'
  return ''
}

// Scheduled, crewed, and nothing sent yet. This is the moment to offer.
export function workOrderReady(job) {
  return !workOrderBlocker(job) && ['none', 'failed'].includes(workOrderStatusOf(job))
}

export function isWorkOrderOut(job) {
  return ['pending', 'sent', 'opened'].includes(workOrderStatusOf(job))
}


/* ---------------------------------------------------------------------------
   Chasing signatures.

   The daily sweep posts to Slack about any job installing inside the next 14
   days with a document still unsigned. It stops on a signature and on nothing
   else, so the only way to quieten one job without quietening the rule is to
   pause it deliberately, which is what these two do.

   The rule itself is in nag.js, which imports nothing, so the repo check can
   run it without a database. These need Supabase, so they stay here.
--------------------------------------------------------------------------- */

export async function pauseNag(jobId, days) {
  return attempt(
    () => supabase.rpc('snooze_job_nag', { p_job_id: jobId, p_days: days }),
    'Reminders could not be paused.',
  )
}

export async function resumeNag(jobId) {
  return attempt(
    () => supabase.rpc('resume_job_nag', { p_job_id: jobId }),
    'Reminders could not be turned back on.',
  )
}
