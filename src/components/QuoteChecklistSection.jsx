import { useMemo } from 'react'
import SalesChecklistFields from './SalesChecklistFields'
import { CHECKLIST_ITEMS, NOT_SURE, YES, isAnswered, supportsNotSure } from '../lib/salesChecklist'

/**
 * One collapsible half of the checklist.
 *
 * On a call these questions are the job, so a section opens by default and
 * stays open. When the sale already happened on the phone and somebody is
 * filling the record in afterwards, the whole block is noise, so it folds.
 *
 * Each section gets the one bulk action that is true for it, which is why
 * they are grouped by the kind of answer rather than by where you are
 * standing. All clear says yes to four things you answered by looking, and
 * that is a real answer. Not sure yet says nobody knows, which is the only
 * honest blanket answer to a measurement. A blanket yes on a drain distance
 * would be inventing a number, so no section offers one.
 */
export default function QuoteChecklistSection({
  title, note, keys, bulk, bulkLabel, value, onChange, open, onToggle, disabled,
}) {
  const items = useMemo(() => CHECKLIST_ITEMS.filter(i => keys.includes(i.key)), [keys])

  const answered = items.filter(item => isAnswered(value, item.key)).length
  const left = items.length - answered
  const id = `checklist-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`

  function fillRest() {
    const next = { ...value }

    for (const item of items) {
      if (isAnswered(value, item.key)) continue

      if (bulk === 'yes') next[item.key] = YES
      else if (supportsNotSure(item)) next[item.key] = NOT_SURE
    }

    onChange(next)
    onToggle(false)
  }

  return (
    <section className="quote-card quote-check">
      <div className="quote-check-head">
        <button
          type="button" className="quote-check-toggle"
          aria-expanded={open} aria-controls={id} onClick={() => onToggle(!open)}
        >
          <span aria-hidden="true" className={open ? 'quote-check-arrow quote-check-arrow-open' : 'quote-check-arrow'}>
            &rsaquo;
          </span>
          <span className="quote-check-title">{title}</span>
          <span className={left === 0 ? 'quote-check-count quote-check-done' : 'quote-check-count'}>
            {left === 0 ? 'All answered' : `${answered} of ${items.length}`}
          </span>
        </button>

        {open && left > 0 && bulk && (
          <button
            type="button" className="tpl-link quote-check-skip"
            onClick={fillRest} disabled={disabled}
          >
            {bulkLabel}
          </button>
        )}
      </div>

      <div id={id} hidden={!open}>
        {note && <p className="quote-check-note">{note}</p>}
        <SalesChecklistFields
          value={value}
          onChange={onChange}
          keys={keys}
          showJobFields={false}
          title=""
          disabled={disabled}
        />
      </div>
    </section>
  )
}
