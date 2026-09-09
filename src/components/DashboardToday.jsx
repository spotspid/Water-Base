import { Link } from 'react-router-dom'
import { hasOverdue, todayHeadline } from '../lib/today'

// The one bold thing on the page.
//
// A navy block that answers "what needs me today" and nothing else. It is the
// only element in the app with this much weight, which is exactly why it has
// to be earned: when nothing is blocked it says so quietly and the page moves
// on to the money.
//
// The pulse fires only when something is genuinely past its install date.
// A siren that runs every morning is furniture, and the one morning it means
// something it looks the same as the thirty before it.
export default function DashboardToday({ cards, paperworkNote }) {
  const blocked = cards || []
  const overdue = hasOverdue(blocked)
  const headline = todayHeadline(blocked)

  return (
    <section className="today" aria-label="What needs you today">
      <div className="today-lead">
        <p className="today-k">
          {/* aria-hidden: the pulse repeats what the card rails already say,
              and an announced "decorative dot" helps nobody. */}
          {overdue && <span className="beat" aria-hidden="true" />}
          Needs you today
        </p>

        {blocked.length === 0 ? (
          <p className="today-h">
            Nothing is blocked. <em>Every booked install is ready to go.</em>
          </p>
        ) : (
          <p className="today-h">
            {headline.lead}
            <em>{headline.emphasis}</em>
            {headline.tail}
          </p>
        )}

        {paperworkNote && <p className="today-sub">{paperworkNote}</p>}
      </div>

      {blocked.length > 0 && (
        <ul className="blockers">
          {blocked.map(card => (
            <li key={card.job_id} className={`bk bk-${card.urgency}`}>
              <Link to="/jobs" className="bk-link">
                <span className={`bk-when bk-when-${card.urgency}`}>{card.when}</span>
                <span className="bk-who">{card.who}</span>
                <span className="bk-need">{card.needs}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="today-acts">
        <Link to="/schedule" className="btn-ghost">Open schedule</Link>
      </div>
    </section>
  )
}
