import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { isWorkOrderOut } from '../lib/agreements'
import './Agreement.css'

// Site conditions on the job record, editable in place.
//
// It sits beside the work order rather than with the rest of the job detail
// because that is the only place it goes. Everything else on a work order is
// derived from somewhere; this is the one thing a person has to type, and it
// is usually learned on the phone after the job was written up, which is why
// it is editable here and not only on the new job form.
export default function JobSiteConditions({ job, onChanged }) {
  const stored = job.site_conditions || ''
  const [draft, setDraft] = useState(stored)
  const [saved, setSaved] = useState(stored)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // The row can change underneath this panel, because every action in the
  // modal reloads the job. Follow the new value, unless there is unsaved
  // typing in the box, which is never worth throwing away silently.
  useEffect(() => {
    const next = job.site_conditions || ''
    if (next === saved) return
    if (draft === saved) setDraft(next)
    setSaved(next)
  }, [job.site_conditions, saved, draft])

  const dirty = draft !== saved
  const sent = isWorkOrderOut(job) || job.work_order_status === 'completed'

  async function save() {
    setError('')
    setNotice('')
    setBusy(true)

    const value = draft.trim()

    const { error: err } = await attempt(
      () => supabase
        .from('jobs')
        .update({ site_conditions: value || null })
        .eq('id', job.id),
      'The site conditions could not be saved.',
    )

    setBusy(false)

    if (err) {
      setError(err)
      return
    }

    setDraft(value)
    setSaved(value)
    setNotice(value
      ? sent
        ? 'Saved. The work order already sent still shows the old text, so resend it if this matters.'
        : 'Saved. This goes on the work order.'
      : 'Cleared. The work order will leave that box blank.')
    onChanged()
  }

  return (
    <section className="agr-panel">
      <div className="agr-head">
        <div>
          <h3>Site Conditions</h3>
          <p className="agr-sub">
            What the installer needs to know about the house before he gets there.
            Blank is fine, and prints as a blank box rather than a note saying there
            is nothing to say.
          </p>
        </div>
      </div>

      <div className="field">
        <textarea
          rows="3"
          value={draft}
          disabled={busy}
          aria-label="Site conditions for this job"
          placeholder="Access, where the shutoff is, stairs, a dog, a tenant"
          onChange={e => { setDraft(e.target.value); setNotice('') }}
        />
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="set-notice" role="status">{notice}</p>}

      <div className="agr-actions">
        <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={save}>
          {busy ? 'Saving...' : 'Save Site Conditions'}
        </button>
        {dirty && !busy && (
          <button type="button" className="btn-cancel" onClick={() => { setDraft(saved); setError('') }}>
            Undo
          </button>
        )}
      </div>
    </section>
  )
}
