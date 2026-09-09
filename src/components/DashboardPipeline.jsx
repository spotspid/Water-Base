import { freshness, funnelBands, hasPipeline, pipelineMoney } from '../lib/pipeline'

// What sales thinks is coming.
//
// A dark panel, which is the second and last thing on this page allowed any
// weight. It sits below the money and the paperwork on purpose: none of it
// reserves a part or schedules a van, so it is the last thing an operator
// needs and the first thing they might want.
//
// Read only in the strongest sense. Nothing here can be clicked through to an
// action, because there is no action to take: jobs are written by hand and the
// overnight reconcile catches the gap.
export default function DashboardPipeline({ summary, funnel, error }) {
  if (error) {
    return (
      <section className="dash-panel dash-panel-dark" aria-label="Sales pipeline">
        <div className="pipe">
          <p className="pipe-error" role="status">
            The GoHighLevel pipeline could not be read, so the figures above are the
            shop&apos;s own only. {error}
          </p>
        </div>
      </section>
    )
  }

  if (!hasPipeline(summary)) return null

  const bands = funnelBands(funnel)
  const age = freshness(summary.last_synced_at)

  return (
    <section className="dash-panel dash-panel-dark" aria-label="Sales pipeline">
      <header className="dash-panel-head">
        <h2>Pipeline</h2>
        <span className={`dash-panel-note dash-age-${age.state}`}>
          GoHighLevel, synced {age.label}
        </span>
      </header>

      <div className="pipe">
        <div className="pipe-row">
          <Figure label="Open" value={summary.open_count} />
          <Figure label="Open value" value={pipelineMoney(summary.open_value)} />
          <Figure label="Won" value={summary.won_count} high />
          <Figure label="Won value" value={pipelineMoney(summary.won_value)} high />
        </div>

        {bands.length > 0 && (
          <ul className="pipe-stages">
            {bands.map(band => (
              <li key={band.stage} className="stage">
                <span className="st-n" title={band.stage}>{band.stage}</span>
                <span className="st-bar">
                  <span className="st-fill" style={{ '--band': `${band.width}%` }} />
                </span>
                <span className="st-c">{band.count}</span>
                <span className="st-v">{pipelineMoney(band.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function Figure({ label, value, high }) {
  return (
    <span className="pf">
      <span className="pf-k">{label}</span>
      <span className={high ? 'pf-v pf-v-hi' : 'pf-v'}>{value}</span>
    </span>
  )
}
