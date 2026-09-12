import { supabase } from './supabase'
import { attempt, attemptRows } from './errors'
import { CANCELLED_STATUS, STATUS_LABELS } from './constants'
import { formatCurrency } from './inventory'
import { formatLongDate } from './schedule'

// The moves a job can make from its own modal. Each returns { error } or
// { message }, both already sentences, so the modal only has to show
// whichever came back.
//
// Sold and scheduled are never written directly. schedule_job decides them
// from the date, and it is also where parts are claimed and released, so a
// status written by a plain update could disagree with the calendar and the
// shelf at the same time. That is what used to happen: "Mark scheduled" wrote
// the word with no date, and the next crew save, which goes through
// schedule_job, quietly put the job back to sold.

export function statusLabel(status) {
  return STATUS_LABELS[status] || status
}

export async function markInstalled(job, installDate) {
  const { data, error } = await attempt(
    () => supabase.rpc('mark_job_installed', {
      p_job_id: job.id,
      p_install_date: installDate || null,
      // Crew and pay are already on the row, saved through schedule_job and
      // its roster rules. A null payout tells the function to keep the saved
      // one rather than overwrite it with nothing.
      p_installer: null,
      p_payout: null,
    }),
    'The job could not be marked installed.',
  )

  if (error) return { error }

  const lines = data?.lines_deducted ?? 0
  return {
    message: lines === 0
      ? 'Marked installed. This template has no parts, so nothing was deducted from inventory.'
      : `Marked installed. ${lines} ${lines === 1 ? 'item' : 'items'} deducted, ${formatCurrency(data?.parts_cost || 0)} of parts.`,
  }
}

export async function revertInstall(job, revertTo) {
  const { data, error } = await attempt(
    () => supabase.rpc('revert_job_install', { p_job_id: job.id, p_new_status: revertTo }),
    'The install could not be reversed.',
  )

  if (error) return { error }

  const lines = data?.lines_reversed ?? 0
  return {
    message: `Install reversed. ${lines} ${lines === 1 ? 'item was' : 'items were'} returned to inventory, and the job is now ${statusLabel(revertTo)} with its parts promised again.`,
  }
}

// Cancelling and reopening. Both are plain updates, because a cancelled job
// cannot go through schedule_job, and the database trigger does the
// reservation work either way. This only has to say what happened.
export async function changeStatus(job, next) {
  const { error } = await attemptRows(
    () => supabase.from('jobs').update({ status: next }).eq('id', job.id),
    'The status could not be changed.',
  )

  if (error) return { error }

  if (next === CANCELLED_STATUS) {
    return {
      message: 'Job cancelled. Every part it had promised is released and back in available. '
        + 'Nothing moved in the ledger, because a cancelled job never consumed anything.',
    }
  }

  if (job.status === CANCELLED_STATUS) {
    return {
      message: `Job reopened as ${statusLabel(next)}.`
        + (job.scheduled_date
          ? ' Its parts are promised again.'
          : ' It has no date, so it promises no parts until it is scheduled.'),
    }
  }

  return { message: `Job moved to ${statusLabel(next)}.` }
}

// A date puts the job on the schedule and claims its parts. No date takes it
// off and releases them. The crew is left alone either way, which is what
// p_set_crew false means.
export async function setScheduledDate(job, date) {
  const { data, error } = await attempt(
    () => supabase.rpc('schedule_job', {
      p_job_id: job.id,
      p_scheduled_date: date || null,
      // the window belongs to the date, so without one there is nothing to keep
      p_time_window: date ? (job.time_window || null) : null,
      p_installer_id: null,
      p_helper_id: null,
      p_set_crew: false,
    }),
    date ? 'The job could not be scheduled.' : 'The job could not be moved back to sold.',
  )

  if (error) return { error }

  if (!date) {
    return {
      message: 'Back to sold. The date is cleared, the job is off the calendar, and any parts '
        + 'it had promised are back in available.',
    }
  }

  const conflicts = Number(data?.conflict_count) || 0
  const short = conflicts > 0
    ? ` ${conflicts} ${conflicts === 1 ? 'part is' : 'parts are'} short for that day.`
    : ''

  return {
    message: `Scheduled for ${formatLongDate(date)}. Its parts are promised for that day and the crew is unchanged.${short}`,
  }
}

// What a save through schedule_job did to the status, if anything. Saying so
// is the difference between a job that changed for a reason and one that
// changed behind somebody's back.
export function describeStatusShift(before, after) {
  if (!after || before === after) return ''
  return ` It is now ${statusLabel(after)} rather than ${statusLabel(before)}, because a job with a date is scheduled and one without is sold.`
}
