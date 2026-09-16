// Says which named list the jobs page is showing, and how to leave it.
//
// Opened from a dashboard tile, the page would otherwise look like the full
// jobs list with some jobs missing and no reason given. An address with a view
// name nobody recognises is said out loud too, rather than quietly showing
// everything as if the link had worked.
export default function JobsViewBanner({ viewKey, view, count, onClear }) {
  if (!viewKey) return null

  return (
    <div className="jobs-view-banner" role="status">
      <div>
        <p className="jobs-view-title">{view ? view.title : 'Unknown list'}</p>
        <p className="jobs-view-detail">
          {!view && `This link asked for a list called "${viewKey}", which does not exist, so every job is shown.`}
          {view && count > 0 && view.describe(count)}
          {view && count === 0 && view.empty}
        </p>
      </div>
      <button type="button" className="btn-cancel btn-small" onClick={onClear}>
        Show all jobs
      </button>
    </div>
  )
}
