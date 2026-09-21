import './EmptyState.css'

// One shape for every "there is nothing here yet" on the app.
//
// The distinction worth keeping is between empty and broken. A bare line of
// grey text reads as a page that failed to load. A heading, a sentence saying
// why it is empty, and the next thing to do reads as a page waiting for work,
// which is what these pages actually are on a fresh install.
//
// tone 'start' is a system with no data yet and something to do about it.
// tone 'filtered' is a system with data that this filter happens to exclude,
// where the fix is to change the filter rather than to add records.
export default function EmptyState({ title, children, actions, tone = 'start', compact }) {
  const classes = [
    'empty-state',
    `empty-state-${tone}`,
    compact ? 'empty-state-compact' : '',
  ].filter(Boolean).join(' ')

  return (
    <section className={classes}>
      <h2 className="empty-state-title">{title}</h2>
      {children && <div className="empty-state-body">{children}</div>}
      {actions && <div className="empty-state-actions">{actions}</div>}
    </section>
  )
}
