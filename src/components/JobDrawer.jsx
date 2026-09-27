import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { JOB_MARGIN_COLUMNS } from '../lib/jobColumns'
import Modal from './Modal'
import JobDetailModal from './JobDetailModal'

// The job drawer, opened from a page that is not the jobs list.
//
// It used to be that every link to a job went to /jobs?job=<id>, so opening a
// job from Documents left Documents. Closing it then dropped you on the jobs
// list, under Operations, two moves from the row you had been working. The
// page you were on is the page you should be on afterwards.
//
// This loads the one job it is asked for, with the same columns the jobs list
// reads, so the drawer behaves identically wherever it is opened. Everything
// inside it is JobDetailModal exactly as before.
export default function JobDrawer({ jobId, onClose, onChanged }) {
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!jobId) return

    setLoading(true)

    const { data, error: err } = await attempt(
      () => supabase.from('job_margin').select(JOB_MARGIN_COLUMNS).eq('id', jobId).maybeSingle(),
      'That job could not be opened.',
    )

    setLoading(false)

    if (err) {
      setError(err)
      setJob(null)
      return
    }

    setError('')
    setJob(data || null)
  }, [jobId])

  useEffect(() => { load() }, [load])

  // Anything the drawer does reloads the job it is showing, and tells the page
  // underneath so its list reloads too. Both, because the drawer's own figures
  // have to be right while it is open and the row behind it has to be right
  // when it closes.
  const handleChanged = useCallback(() => {
    load()
    onChanged?.()
  }, [load, onChanged])

  if (!jobId) return null

  if (loading && !job) {
    return (
      <Modal title="Opening the job" onClose={onClose} dismissOnBackdrop={false}>
        <p className="inv-state">Loading...</p>
      </Modal>
    )
  }

  if (error || !job) {
    return (
      <Modal title="That job could not be opened" onClose={onClose} dismissOnBackdrop={false}>
        <p className="form-error" role="alert">
          {error || 'It may have been deleted since this page was loaded.'}
        </p>
      </Modal>
    )
  }

  return <JobDetailModal job={job} onClose={onClose} onChanged={handleChanged} />
}
