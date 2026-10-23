import {
  NO, NOT_SURE, NOT_SURE_LABEL, YES,
  answer, applyBulk, countAnswered, isAnswered, isNotSure, itemFor, noteApplies,
} from '../../lib/v2Checklist'
import './Checklist.css'

// One section of the quote's questions, and the button that fills it.
//
// Folds, because when the sale already happened on the phone the whole block
// is noise. Open by default, because on a call these questions are the job.

function YesNo({ item, value, onPick, disabled }) {
  const options = [
    [YES, 'Yes'],
    [NO, 'No'],
    [NOT_SURE, NOT_SURE_LABEL],
  ]

  return (
    <div className="v2c-choices" role="group" aria-label={item.label}>
      {options.map(([key, label]) => (
        <button
          key={key} type="button" disabled={disabled}
          className={value === key ? 'v2c-choice v2c-choice-on' : 'v2c-choice'}
          aria-pressed={value === key}
          onClick={() => onPick(value === key ? '' : key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function ChecklistSection({ section, value, onChange, open, onToggle, disabled }) {
  const items = section.keys.map(itemFor).filter(Boolean)
  const answered = countAnswered(value, section.keys)
  const left = items.length - answered
  const id = `v2c-${section.id}`

  function fill() {
    onChange(applyBulk(value, section))
    onToggle(false)
  }

  return (
    <section className="quote-card v2c">
      <div className="v2c-head">
        <button
          type="button" className="v2c-toggle"
          aria-expanded={open} aria-controls={id} onClick={() => onToggle(!open)}
        >
          <span aria-hidden="true" className={open ? 'v2c-arrow v2c-arrow-open' : 'v2c-arrow'}>&rsaquo;</span>
          <span className="v2c-title">{section.title}</span>
          <span className={left === 0 ? 'v2c-count v2c-count-done' : 'v2c-count'}>
            {left === 0 ? 'All answered' : `${answered} of ${items.length}`}
          </span>
        </button>

        {open && left > 0 && (
          <button type="button" className="tpl-link v2c-bulk" onClick={fill} disabled={disabled}>
            {section.bulkLabel}
          </button>
        )}
      </div>

      <div id={id} hidden={!open}>
        {section.note && <p className="v2c-note">{section.note}</p>}

        <div className="v2c-items">
          {items.map(item => (
            <div key={item.key} className="v2c-item">
              <div className="v2c-label">
                <span>{item.label}</span>
                {!isAnswered(value, item.key) && <span className="v2c-tag">Not answered</span>}
                {isNotSure(value, item.key) && <span className="v2c-tag v2c-tag-quiet">{NOT_SURE_LABEL}</span>}
              </div>

              {item.kind === 'yesno' && (
                <YesNo
                  item={item}
                  value={value[item.key]}
                  disabled={disabled}
                  onPick={next => onChange(answer(value, item.key, next))}
                />
              )}

              {item.kind === 'count' && (
                <input
                  type="number" min="0" aria-label={item.label}
                  value={value[item.key]} disabled={disabled}
                  onChange={e => onChange(answer(value, item.key, e.target.value))}
                />
              )}

              {item.kind === 'text' && (
                <input
                  type="text" aria-label={item.label} placeholder={item.placeholder}
                  value={value[item.key]} disabled={disabled}
                  onChange={e => onChange(answer(value, item.key, e.target.value))}
                />
              )}

              {item.kind === 'choice' && (
                <select
                  aria-label={item.label} value={value[item.key]} disabled={disabled}
                  onChange={e => onChange(answer(value, item.key, e.target.value))}
                >
                  <option value="">Not chosen</option>
                  {item.options.map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                  <option value={NOT_SURE}>{NOT_SURE_LABEL}</option>
                </select>
              )}

              {/* Only when the answer is no. Nobody who looks at a receptacle
                  and sees a receptacle has anything to write down. */}
              {noteApplies(value, item.key) && (
                <input
                  type="text" className="v2c-item-note"
                  aria-label={`What is the problem with ${item.label.toLowerCase()}`}
                  placeholder="What is the problem?"
                  value={value[`${item.key}_note`] ?? ''} disabled={disabled}
                  onChange={e => onChange({ ...value, [`${item.key}_note`]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
