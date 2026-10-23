import { useMemo } from 'react'
import SalesChecklistFields from './SalesChecklistFields'
import { CHECKLIST_ITEMS, NOT_SURE, isAnswered, supportsNotSure } from '../lib/salesChecklist'

/**
 * One collapsible half of the checklist.
 *
 * On a call these questions are the job, so a section opens by default and
 * stays open. When the sale already happened on the phone and somebody is
 * filling the record in afterwards, the whole block is noise, so it folds.
 *
 * The shortcut says "Not sure yet on the rest" rather than "mark all done",
 * which is what it was asked to say. Done would be a lie: nobody answered
 * those questions, and writing them in as answered loses the difference
 * between a thing that was asked and a thing that was skipped. Not sure yet
 * already means asked and nobody knew, it already clears the gaps on a quote,
 * and it already turns back into a gap once the job is sold, which is exactly
 * when somebody has to go and find out.
 */
export default function QuoteChecklistSection({
  title, keys, value, onChange, open, onToggle, disabled,
}) {
  const items = useMemo(() => CHECKLIST_ITEMS.filter(i => keys.includes(i.key)), [keys])

  const answered = items.filter(item => isAnswered(value, item.key)).length
  const left = items.length - answered
  const id = `checklist-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`

  function markRestNotSure() {
    const next = { ...value }

    for (const item of items) {
      if (isAnswered(value, item.key)) continue
      if (supportsNotSure(item)) next[item.key] = NOT_SURE
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

        {open && left > 0 && (
          <button
            type="button" className="tpl-link quote-check-skip"
            onClick={markRestNotSure} disabled={disabled}
          >
            Not sure yet on the rest
          </button>
        )}
      </div>

      <div id={id} hidden={!open}>
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
