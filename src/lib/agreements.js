import { supabase } from './supabase'

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
