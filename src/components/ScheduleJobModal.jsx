import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { STATUS_LABELS } from '../lib/constants'
import { attempt } from '../lib/errors'
import { useSettings, withCurrent } from '../lib/settings'
import { useInstallers } from '../lib/useInstallers'
import { formatLongDate, isMovable } from '../lib/schedule'
import { metaLine } from '../lib/text'
import ScheduleConflicts from './ScheduleConflicts'
import Modal from './Modal'

// Book one job: a day, a window, a lead and a helper.
//
// The parts check runs when the modal opens rather than when it saves, so the
// warning is on screen while the decision is being made instead of after it.
export default function ScheduleJobModal({ job, onClose, onSaved }) {
  const { allOptions, loading: loadingSettings } = useSettings()
  const { installers, loading: loadingCrew, error: crewError } = useInstallers({ activeOnly: true })

  const [form, setForm] = useState({
    scheduled_date: job.scheduled_date || '',
    time_window: job.time_window || '',
    installer_id: job.installer_id || '',
    helper_id: job.helper_id || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [conflicts, setConflicts] = useState(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')

  const movable = isMovable(job)

  const windowRows = allOptions?.time_window || []
  const windowOptions = withCurrent(
    windowRows.filter(o => o.active).map(o => o.value),
    job.time_window,
  )

  const checkConflicts = useCallback(async () => {
    setChecking(true)
    setCheckError('')

    const { data, error: err } = await attempt(
      () => supabase.rpc('job_schedule_conflicts', { p_job_id: job.id }),
      'Parts availability could not be checked.',
    )

    if (err) {
      setCheckError(err)
      setConflicts(null)
    } else {
      setConflicts(Array.isArray(data) ? data : [])
    }

    setChecking(false)
  }, [job.id])

  useEffect(() => {
    if (!movable) {
      setConflicts([])
      return
    }
    checkConflicts()
  }, [checkConflicts, movable])

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    setError('')
    setNotice('')
  }

  function validate() {
    if (form.installer_id && form.helper_id && form.installer_id === form.helper_id) {
      return 'The installer and the helper cannot be the same person.'
    }
    if (!form.scheduled_date && form.time_window) {
      return 'Pick a date before picking a time window, or clear the window.'
    }
    return ''
  }

  async function handleSave() {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }

    setError('')
    setNotice('')
    setSaving(true)

    const { data, error: err } = await attempt(
      () => supabase.rpc('schedule_job', {
        p_job_id: job.id,
        p_scheduled_date: form.scheduled_date || null,
        p_time_window: form.time_window || null,
        p_installer_id: form.installer_id || null,
        p_helper_id: form.helper_id || null,
        p_set_crew: true,
      }),
      'The job could not be scheduled.',
    )

    setSaving(false)

    if (err) {
      setError(err)
      onSaved()
      return
    }

    const count = Number(data?.conflict_count) || 0
    setConflicts(Array.isArray(data?.conflicts) ? data.conflicts : [])
    setNotice(describeSave(data, count))
    onSaved()
  }

  const subtitle = metaLine([
    job.system_template,
    job.city,
    job.invoice_number && `Invoice ${job.invoice_number}`,
  ])

  return (
    <Modal title={job.customer_name} subtitle={subtitle} onClose={onClose} wide>
      <p className="sch-modal-address">
        {job.address}
        {job.phone && <span className="sch-modal-phone">{job.phone}</span>}
        <span className={`status-badge status-${job.status}`}>
          {STATUS_LABELS[job.status] || job.status}
        </span>
      </p>

      {!movable && (
        <p className="inv-state">
          This job is {STATUS_LABELS[job.status] || job.status}, so its date is a record
          rather than a plan.
          {job.install_date && ` It was installed ${formatLongDate(job.install_date)}.`}
          {' '}Reverse the install from the Jobs page if it needs to move.
        </p>
      )}

      {movable && (
        <>
          {crewError && (
            <p className="form-warning" role="alert">
              {crewError} The date and window can still be saved, but the crew list is empty.
            </p>
          )}

          <div className="form-grid sch-form-grid">
            <div className="field">
              <label htmlFor="scheduled_date">Scheduled Date</label>
              <input id="scheduled_date" name="scheduled_date" type="date"
                value={form.scheduled_date} onChange={handleChange} disabled={saving} />
              <span className="field-hint">Clearing the date puts this job back in Unscheduled.</span>
            </div>

            <div className="field">
              <label htmlFor="time_window">Time Window</label>
              <select id="time_window" name="time_window" value={form.time_window}
                onChange={handleChange} disabled={saving || loadingSettings}>
                <option value="">{loadingSettings ? 'Loading windows...' : 'No window'}</option>
                {windowOptions.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>

            <div className="field">
              <label htmlFor="installer_id">Installer</label>
              <select id="installer_id" name="installer_id" value={form.installer_id}
                onChange={handleChange} disabled={saving || loadingCrew}>
                <option value="">{loadingCrew ? 'Loading crew...' : 'Unassigned'}</option>
                {installers.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <span className="field-hint">Managed on the Settings page.</span>
            </div>

            <div className="field">
              <label htmlFor="helper_id">Helper <span className="optional">(optional)</span></label>
              <select id="helper_id" name="helper_id" value={form.helper_id}
                onChange={handleChange} disabled={saving || loadingCrew}>
                <option value="">None</option>
                {installers
                  .filter(i => i.id !== form.installer_id)
                  .map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
          </div>
        </>
      )}

      <ScheduleConflicts
        conflicts={conflicts}
        checking={checking}
        error={checkError}
        onRetry={movable ? checkConflicts : null}
      />

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="job-notice" role="status">{notice}</p>}

      <div className="modal-actions">
        <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>
          Close
        </button>
        {movable && (
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Schedule'}
          </button>
        )}
      </div>
    </Modal>
  )
}

function describeSave(data, count) {
  const when = data?.scheduled_date ? formatLongDate(data.scheduled_date) : ''
  const base = when
    ? `Scheduled for ${when}${data?.time_window ? `, ${data.time_window}` : ''}.`
    : 'Date cleared. This job is back in Unscheduled and its status is Sold.'

  if (count === 0) return `${base} Nothing is short.`

  return `${base} Saved with ${count} parts ${count === 1 ? 'warning' : 'warnings'}, listed above.`
}
