import { Link } from 'react-router-dom'

// An address that goes nowhere.
//
// This used to bounce to the sign in screen, which is the wrong message twice
// over: a signed in operator who mistyped a link was told they were logged
// out, and a signed out one never learned the link was bad. Saying what
// happened costs one small page and it stays in the main bundle, because a
// wrong address is not worth a second round trip to explain.
export default function NotFound() {
  return (
    <div className="route-error">
      <div className="route-error-card" role="alert">
        <h1>There is no page at this address</h1>
        <p>
          The link may be out of date, or the address was mistyped. Nothing has been
          signed out. The dashboard is the place to start from.
        </p>
        <p className="route-error-detail">{window.location.pathname}</p>
        <div className="route-error-actions">
          <Link className="btn-primary" to="/dashboard">Go to the dashboard</Link>
          <Link className="btn-cancel" to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  )
}
