import { supabase } from './supabase.js'
import { attempt } from './errors.js'
import { workOrderReady as readyToSend } from './workOrder.js'

export { WORK_ORDER_TYPE, agreedPay, workOrderBlocker } from './workOrder.js'

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
export async function sendAgreement(jobId, type = 'customer_install', { quote = false } = {}) {
  try {
    const { data, error } = await supabase.functions.invoke('send-agreement', {
      body: { job_id: jobId, type, ...(quote ? { quote: true } : {}) },
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

// A quote is the customer agreement with the quote written into DocuSeal's
// email. Same function, same record, and a signature on it closes the sale.
export function sendQuote(jobId) {
  return sendAgreement(jobId, 'customer_install', { quote: true })
}

/* ---------------------------------------------------------------------------
   Work orders.

   Stored as an agreements row of type subcontractor_service, so it shares the
   table, the status vocabulary and the webhook with the customer agreement.
   Only the reader differs: this one goes to the installer, not the customer.
--------------------------------------------------------------------------- */

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

// The rule about whether a work order may go at all lives in workOrder.js,
// which imports nothing so the repo check can run it against the same
// assertions the edge function is held to. This is only the binding.
export function workOrderReady(job) {
  return readyToSend(job, workOrderStatusOf)
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

// Signed documents a job keeps but does not point at: a work order redone for
// a new date, or one signed by an installer who did not finish. Oldest first,
// so they read as the order things happened in.
export async function fetchAgreementHistory(jobId) {
  return attempt(
    () => supabase
      .from('agreement_history')
      .select('id, type, docuseal_submission_id, status, sent_at, completed_at, signed_by, note')
      .eq('job_id', jobId)
      .order('completed_at', { ascending: true, nullsFirst: false }),
    'The earlier documents on this job could not be loaded.',
  )
}

/**
 * One page of the DocuSeal account listing, through the function's read only
 * list mode.
 *
 * The API key is an edge function secret, so the browser cannot read DocuSeal
 * directly and should not: this goes through the same function the sends do,
 * in the mode that only ever performs a GET. Nothing here writes to DocuSeal
 * or to Water Base.
 */
export async function listSubmissions({ archived = false, after = '' } = {}) {
  try {
    const { data, error } = await supabase.functions.invoke('send-agreement', {
      body: { list: true, archived, ...(after ? { after } : {}) },
    })

    if (!error) {
      return {
        rows: data?.submissions?.data || [],
        next: data?.submissions?.pagination?.next ?? null,
        error: null,
      }
    }

    let message = error.message || 'DocuSeal could not be read.'
    try {
      const body = await error.context?.json?.()
      if (body?.error) message = body.error
    } catch {
      // no JSON body, so the generic message stands
    }

    return { rows: [], next: null, error: message }
  } catch (caught) {
    return {
      rows: [],
      next: null,
      error: caught?.message || 'DocuSeal could not be reached. Check your connection.',
    }
  }
}
