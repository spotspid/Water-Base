import { freshness, funnelBands, hasPipeline, pipelineMoney } from '../lib/pipeline'

// What sales thinks is coming, above the shop's own numbers.
//
// Deliberately quieter than everything below it. No card, no shadow, no teal
// figures the size of the revenue tiles: one line of counts and a funnel drawn
// in a single muted colour. Shortages and readiness are what somebody acts on
// this morning, and a pipeline strip that outshouted them would be the tail
// wagging the dog.
//
// It is also read only in the strongest sense. Nothing here can be clicked
// through to an action, because there is no action to take: jobs are written
// by hand and the overnight reconcile is what catches the gap.
export default function DashboardPipeline({ summary, funnel, error }) {
  if (error) {
    return (
      <section className="dash-crm" aria-label="Sales pipeline">
        <p className="dash-crm-error" role="status">
          The GoHighLevel pipeline could not be read, so the figures below are
          the shop's own only. {error}
        </p>
      </section>
    )
  }

  if (!hasPipeline(summary)) return null

  const bands = funnelBands(funnel)
  const age = freshness(summary.last_synced_at)

  return (
    <section className="dash-crm" aria-label="Sales pipeline">
      <div className="dash-crm-head">
        <span className="eyebrow">Pipeline</span>
        <span className={`dash-crm-age dash-crm-age-${age.state}`}>
          GoHighLevel, synced {age.label}
        </span>
      </div>

      <div className="dash-crm-figures">
        <Figure label="Open" value={summary.open_count} />
        <Figure label="Open value" value={pipelineMoney(summary.open_value)} />
        <Figure label="Won" value={summary.won_count} />
        <Figure label="Won value" value={pipelineMoney(summary.won_value)} />
      </div>

      {bands.length > 0 && (
        <ul className="dash-funnel">
          {bands.map(band => (
            <li key={band.stage} className="dash-funnel-row">
              <span className="dash-funnel-stage" title={band.stage}>{band.stage}</span>
              <span className="dash-funnel-track">
                <span className="dash-funnel-bar" style={{ '--band': `${band.width}%` }} />
              </span>
              <span className="dash-funnel-count">{band.count}</span>
              <span className="dash-funnel-value">{pipelineMoney(band.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Figure({ label, value }) {
  return (
    <span className="dash-crm-figure">
      <span className="dash-crm-label">{label}</span>
      <span className="dash-crm-value">{value}</span>
    </span>
  )
}
