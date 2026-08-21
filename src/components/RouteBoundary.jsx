import { Component } from 'react'

// Catches a page that fails to load or throws while rendering.
//
// Route level code splitting introduces a failure that did not exist when
// everything shipped in one file: the browser asks for a chunk and does not
// get it. That happens on a flaky connection, and it happens reliably to
// anyone with the app open when a new version deploys, because the file their
// page is pointing at no longer exists on the server. A blank screen is the
// default outcome and a reload is the actual fix, so this says so.
export default class RouteBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const message = String(error?.message || '')
    // Vite and the browsers word this differently, so match loosely
    const isChunkFailure = /dynamically imported module|importing a module script|failed to fetch|chunk/i
      .test(message)

    return (
      <div className="route-error">
        <div className="route-error-card" role="alert">
          <h1>{isChunkFailure ? 'This page could not be loaded' : 'Something went wrong'}</h1>

          {isChunkFailure ? (
            <p>
              The app could not fetch part of itself. That usually means a new version was
              deployed while this tab was open, or the connection dropped. Reloading gets
              the current version.
            </p>
          ) : (
            <p>
              This page hit an error it could not recover from. Reloading usually clears it.
              If it keeps happening, the detail below is what to report.
            </p>
          )}

          {message && <p className="route-error-detail">{message}</p>}

          <div className="route-error-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <a className="btn-cancel" href="/dashboard">Back to dashboard</a>
          </div>
        </div>
      </div>
    )
  }
}
