// The CRM picture, shaped for one strip on the dashboard.
//
// Context, not the operating layer. Nothing in Water Base is driven by these
// numbers: no part is reserved, no job is created, nothing is scheduled. They
// are here so the shop can see what sales thinks is coming, and so a won deal
// that never became a job is visible before somebody notices the money
// missing.
//
// Pure and importing nothing, so npm run check can run it under Node.

/**
 * How stale the picture is, in plain words.
 *
 * A pipeline strip with no staleness marker is the kind of thing that quietly
 * shows last Tuesday for a month after a cron dies. Anything past a couple of
 * hours is worth saying out loud, because the sync runs hourly and a gap means
 * something is wrong rather than that nothing has changed.
 */
export function freshness(lastSyncedAt, now = new Date()) {
  if (!lastSyncedAt) return { state: 'never', label: 'never synced' }

  const at = new Date(lastSyncedAt)
  if (Number.isNaN(at.getTime())) return { state: 'never', label: 'never synced' }

  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000)

  if (minutes < 0) return { state: 'fresh', label: 'just now' }
  if (minutes < 2) return { state: 'fresh', label: 'just now' }
  if (minutes < 90) return { state: 'fresh', label: `${minutes} min ago` }

  const hours = Math.round(minutes / 60)
  if (hours < 24) return { state: 'stale', label: `${hours} hr ago` }

  const days = Math.round(hours / 24)
  return { state: 'stale', label: `${days} ${days === 1 ? 'day' : 'days'} ago` }
}

/**
 * The funnel, as bands with a width each.
 *
 * Widths are relative to the biggest stage rather than to the total, because
 * against a total the small stages collapse to slivers and the point of a
 * funnel is being able to compare them.
 */
export function funnelBands(rows) {
  const bands = (rows || [])
    .map(row => ({
      stage: String(row?.stage_name || '').trim() || 'Unnamed stage',
      count: Number(row?.opportunities) || 0,
      value: Number(row?.value) || 0,
    }))
    .filter(band => band.count > 0)

  const biggest = bands.reduce((max, b) => (b.count > max ? b.count : max), 0)

  return bands.map(band => ({
    ...band,
    // Never zero for a stage that has something in it: a band with no width
    // reads as a rendering fault rather than as a small number.
    width: biggest > 0 ? Math.max(4, Math.round((band.count / biggest) * 100)) : 0,
  }))
}

// Whole dollars. A pipeline figure with cents on it is pretending to a
// precision a forecast does not have.
export function pipelineMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '$0'
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  })
}

/**
 * Whether there is anything worth drawing.
 *
 * An empty pipeline and a failed load look identical in the data, so the panel
 * asks this rather than inferring from zeroes. Zero open opportunities with a
 * real sync behind it is a fact; zero with no sync is an absence.
 */
export function hasPipeline(summary) {
  if (!summary) return false
  return (Number(summary.total_count) || 0) > 0
}
