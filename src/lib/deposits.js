import { supabase } from './supabase.js'
import { attempt, attemptRows } from './errors.js'

// Reading and writing deposits. How they read on screen is in depositState.js,
// which imports nothing so the repo check can run it.

const DEPOSIT_COLUMNS = 'id, job_id, amount, received_on, method, note, created_at'

export async function fetchDeposits(jobId) {
  return attempt(
    () => supabase.from('job_deposits').select(DEPOSIT_COLUMNS)
      .eq('job_id', jobId)
      .order('received_on', { ascending: false })
      .order('created_at', { ascending: false }),
    'The deposits on this job could not be loaded.',
  )
}

export async function addDeposit(deposit) {
  return attempt(
    () => supabase.from('job_deposits').insert(deposit).select('id').single(),
    'That deposit could not be saved.',
  )
}

export async function removeDeposit(id) {
  return attemptRows(
    () => supabase.from('job_deposits').delete().eq('id', id),
    'That deposit could not be removed.',
  )
}
