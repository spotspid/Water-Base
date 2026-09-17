import {
  CHECKLIST_ITEMS, JOB_FIELD_ITEMS, NO, UNKNOWN, YES,
  isAnswered, itemProblem, unansweredItems,
} from '../lib/salesChecklist'

// The sales checklist, as fields.
//
// Used on the New quote form and in the drawer of a quoted job. It edits the
// checklist object only; the three choices that are columns on the job
// (finish, RO type, payment type) are shown here so the whole checklist reads
// in one place, but they are changed where they already live.
//
// Anything unanswered is amber, and the count at the top says how many.
// Nothing here blocks a save. A quote goes out with gaps; the amber is so the
// gaps get chased before install day rather than found on it.
//
// Choices are selects with an explicit "Not answered" first, rather than
// radio buttons, because a radio group cannot be put back to unanswered once
// somebody taps it, and "no" and "nobody asked" have to stay different.

const CHOICES = {
  yesno: [[YES, 'Yes'], [NO, 'No']],
  yesnounknown: [[YES, 'Yes'], [NO, 'No'], [UNKNOWN, 'Unknown']],
}

// keys limits which checklist items this block shows, and showJobFields
// whether finish, RO type and payment type appear in it. The New quote form
// uses both to split the checklist around the system choice; the drawer passes
// neither and gets the whole checklist in one block. The count and the amber
// are worked out over exactly what is shown, so a half never reports the
// other half's gaps.
export default function SalesChecklistFields({
  value, onChange, job, disabled, onFixJobField, jobFieldsNote,
  keys = null, showJobFields = true, title = 'Sales checklist',
}) {
  const items = keys ? CHECKLIST_ITEMS.filter(i => keys.includes(i.key)) : CHECKLIST_ITEMS
  const jobItems = showJobFields ? JOB_FIELD_ITEMS : []
  const shownKeys = new Set([...items, ...jobItems].map(i => i.key))
  const missing = unansweredItems(value, job).filter(m => shownKeys.has(m.key))
  const total = items.length + jobItems.length
  const answered = total - missing.length

  function set(key, next) {
    const updated = { ...value, [key]: next }
    // A no or a blank cannot keep an upcharge; clearing it here means the form
    // never shows a figure that will not be saved.
    if (key === 'removing_old_equipment' && next !== YES) updated.old_equipment_upcharge = ''
    onChange(updated)
  }

  return (
    <section className="form-section" aria-label={title}>
      <h2>{title}</h2>
      <p className={missing.length === 0 ? 'checklist-count checklist-count-done' : 'checklist-count'}
        role="status">
        {missing.length === 0
          ? `All ${total} answered.`
          : `${answered} of ${total} answered. ${missing.length} still to ask, shown in amber.`}
      </p>

      <div className="form-grid">
        {items.map(item => {
          const open = !isAnswered(value, item.key)
          // A value typed wrong goes amber as it is typed, with the sentence
          // the save would refuse it with, rather than passing as answered
          // until the button is pressed.
          const problem = itemProblem(value, item.key)
          const id = `sc_${item.key}`
          return (
            <div key={item.key}
              className={`field${item.kind === 'text' ? ' field-full' : ''}${open ? ' field-unanswered' : ''}`}>
              <label htmlFor={id}>
                {item.label}
                {open && <span className="unanswered-tag">{problem ? 'Check this' : 'Not answered'}</span>}
              </label>

              {item.kind === 'count' && (
                <input id={id} name={id} type="number" min="0" step="1" inputMode="numeric"
                  value={value[item.key]} disabled={disabled}
                  onChange={e => set(item.key, e.target.value)} />
              )}

              {item.kind === 'text' && (
                <input id={id} name={id} type="text"
                  placeholder="Basement by the water heater, garage, crawlspace..."
                  value={value[item.key]} disabled={disabled}
                  onChange={e => set(item.key, e.target.value)} />
              )}

              {(item.kind === 'yesno' || item.kind === 'yesnounknown') && (
                <select id={id} name={id} value={value[item.key]} disabled={disabled}
                  onChange={e => set(item.key, e.target.value)}>
                  <option value="">Not answered</option>
                  {CHOICES[item.kind].map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              )}

              {item.key === 'removing_old_equipment' && value.removing_old_equipment === YES && (
                <div className="checklist-upcharge">
                  <label htmlFor="sc_old_equipment_upcharge">Upcharge ($)</label>
                  <input id="sc_old_equipment_upcharge" name="sc_old_equipment_upcharge"
                    type="number" min="0" step="0.01" inputMode="decimal"
                    value={value.old_equipment_upcharge} disabled={disabled}
                    onChange={e => onChange({ ...value, old_equipment_upcharge: e.target.value })} />
                </div>
              )}

              {problem && (
                <span className="field-hint checklist-problem" aria-live="polite">{problem}</span>
              )}

              {(item.key === 'shutoff_location' || item.key === 'removing_old_equipment') && (
                <span className="field-hint">Printed on the work order under site conditions.</span>
              )}
            </div>
          )
        })}

        {jobItems.map(item => {
          const current = String(job?.[item.key] ?? '').trim()
          return (
            <div key={item.key} className={current ? 'field' : 'field field-unanswered'}>
              <span className="checklist-job-label">
                {item.label}
                {!current && <span className="unanswered-tag">Not chosen</span>}
              </span>
              <span className="checklist-job-value">
                {current || 'Not chosen yet'}
                {onFixJobField && (
                  <button type="button" className="btn-cancel btn-small" disabled={disabled}
                    onClick={() => onFixJobField(item.key)}>
                    {current ? 'Change' : 'Choose'}
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {jobFieldsNote && <p className="inv-ledger-note">{jobFieldsNote}</p>}
    </section>
  )
}
