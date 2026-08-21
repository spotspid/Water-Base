import { formatMonthLabel, formatWeekLabel } from '../lib/schedule'

// View toggles and range stepping. Split out of the page so the page keeps
// its data loading readable and this stays a pure render of the current mode.
export default function ScheduleToolbar({
  view, onView, mode, onMode, anchor, onStep, onToday, busy,
}) {
  const label = mode === 'month' ? formatMonthLabel(anchor) : formatWeekLabel(anchor)
  const unit = mode === 'month' ? 'month' : 'week'

  return (
    <div className="sch-toolbar">
      <div className="sch-range">
        <button type="button" className="btn-cancel sch-step" disabled={busy}
          onClick={() => onStep(-1)} aria-label={`Previous ${unit}`}>
          &lsaquo;
        </button>
        <span className="sch-range-label">{label}</span>
        <button type="button" className="btn-cancel sch-step" disabled={busy}
          onClick={() => onStep(1)} aria-label={`Next ${unit}`}>
          &rsaquo;
        </button>
        <button type="button" className="tpl-link" onClick={onToday} disabled={busy}>
          Today
        </button>
      </div>

      <div className="sch-switches">
        {view === 'calendar' && (
          <div className="sch-switch" role="group" aria-label="Calendar range">
            <button type="button" disabled={busy}
              className={mode === 'week' ? 'sch-switch-btn sch-switch-on' : 'sch-switch-btn'}
              onClick={() => onMode('week')}>
              Week
            </button>
            <button type="button" disabled={busy}
              className={mode === 'month' ? 'sch-switch-btn sch-switch-on' : 'sch-switch-btn'}
              onClick={() => onMode('month')}>
              Month
            </button>
          </div>
        )}

        <div className="sch-switch" role="group" aria-label="View">
          <button type="button" disabled={busy}
            className={view === 'calendar' ? 'sch-switch-btn sch-switch-on' : 'sch-switch-btn'}
            onClick={() => onView('calendar')}>
            Calendar
          </button>
          <button type="button" disabled={busy}
            className={view === 'list' ? 'sch-switch-btn sch-switch-on' : 'sch-switch-btn'}
            onClick={() => onView('list')}>
            List
          </button>
        </div>
      </div>
    </div>
  )
}
