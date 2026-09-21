// A minimal frame for the page: a heading and a content area.
//
// The original AppShell drew the host app's whole top bar, which pulls in its
// navigation, settings provider and account menu. None of that is part of the
// P&L, so this keeps the same props and nothing else. Replace it with your own
// layout component; the page only needs children, and optionally actions.
export default function AppShell({ children, actions, title = 'Profit and loss', subtitle }) {
  return (
    <main className="canvas">
      <div className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-sub">{subtitle}</p>}
        </div>
        {actions && <div className="page-head-actions">{actions}</div>}
      </div>
      {children}
    </main>
  )
}
