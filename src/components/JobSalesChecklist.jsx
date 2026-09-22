import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt, attemptRows } from '../lib/errors'
import {
  checklistFromForm, checklistToForm, emptyChecklistForm, validateChecklist,
} from '../lib/salesChecklist'
import SalesChecklistFields from './SalesChecklistFields'

// The sales checklist on a quoted or sold job, in its drawer.
//
// On a sold job it is where a Not sure yet gets answered: the database will
// not let the job be booked, crewed or installed while one is open.
//
// Loads jobs.sales_checklist itself rather than through job_margin, the same
// way the work order reads it, so the view does not carry a column only this
// panel uses. If that read fails the rest of the drawer is unaffected: this
// panel says what went wrong and offers to try again.
//
// Saves the checklist object only. Finish, RO type and payment type are
// columns with their own editor, so Choose opens the job's edit form on that
// field rather than a second copy of it here.
export default function JobSalesChecklist({ job, onChanged, onFixJobField }) {
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(emptyChecklistForm)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const jobId = job.id

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')

    const { data, error: err } = await attempt(
      () => supabase.from('jobs').select('sales_checklist').eq('id', jobId).maybeSingle(),
      'The sales checklist could not be loaded.',
    )

    if (err) {
      setLoadError(err)
      setLoading(false)
      return
    }

    const form = checklistToForm(data?.sales_checklist)
    setSaved(form)
    setDraft(form)
    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  // Compared as typed, not as it would be stored. Comparing the stored shape
  // made "2.5 bathrooms" look unchanged, because it is dropped on the way in,
  // so Save stayed disabled and the message saying why never appeared.
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(saved)

  async function save() {
    const problem = validateChecklist(draft)
    if (problem) {
      setError(problem)
      return
    }

    setError('')
    setNotice('')
    setSaving(true)

    const stored = checklistFromForm(draft)
    const { error: err } = await attemptRows(
      () => supabase.from('jobs').update({ sales_checklist: stored }).eq('id', jobId),
      'The sales checklist could not be saved.',
    )

    setSaving(false)

    if (err) {
      setError(err)
      return
    }

    const form = checklistToForm(stored)
    setSaved(form)
    setDraft(form)
    setNotice('Checklist saved.')
    onChanged()
  }

  if (loading) {
    return <p className="inv-state">Loading the sales checklist...</p>
  }

  if (loadError) {
    return (
      <div className="inv-error-box" role="alert">
        <p className="inv-error-title">The sales checklist could not be loaded.</p>
        <p className="inv-error-detail">{loadError}</p>
        <button type="button" className="btn-cancel" onClick={load}>Try again</button>
      </div>
    )
  }

  return (
    <div className="job-sales-checklist">
      <SalesChecklistFields
        value={draft}
        onChange={next => { setDraft(next); setNotice(''); setError('') }}
        job={job}
        disabled={saving}
        onFixJobField={onFixJobField}
      />

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="job-notice" role="status">{notice}</p>}

      <div className="form-actions">
        <button type="button" className="btn-cancel" disabled={saving || !dirty}
          onClick={() => { setDraft(saved); setError(''); setNotice('') }}>
          Undo changes
        </button>
        <button type="button" className="btn-primary" disabled={saving || !dirty} onClick={save}>
          {saving ? 'Saving...' : 'Save checklist'}
        </button>
      </div>
    </div>
  )
}
