import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rateLine } from '../lib/installRates'

// The installer rate card, on the quote form, to read and not to fill in.
//
// It used to be a printed list in a source file, which was true while there
// was one installer. The rows come from install_rate_lines and installer_rates
// now, so the card shows what this installer is actually paid rather than what
// the business pays in general, and a rate that only applies to one of them
// shows on their card alone.
//
// Closed by default. It answers a question that only comes up sometimes, and
// left open it would push the rest of the form down the page for everyone who
// already knows the numbers.
//
// A details element rather than state and a button, so it opens with the
// keyboard, prints open in a browser that expands details for print, and finds
// its own text under a page search even while it is shut.
export default function InstallRateCard({ installerId, installerName }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true

    async function load() {
      // With an installer, their card. Without one, the catalogue, which is
      // what a new installer starts on anyway.
      const query = installerId
        ? supabase.from('installer_rate_card')
          .select('rate_key, label, kind, per, amount, is_own_rate, sort_order')
          .eq('installer_id', installerId)
          .order('sort_order')
        : supabase.from('install_rate_lines')
          .select('key, label, kind, per, default_amount, sort_order')
          .order('sort_order')

      const { data, error: err } = await query
      if (!live) return

      if (err) {
        setError('The rate card could not be read.')
        setRows([])
        return
      }

      setError('')
      setRows((data || []).map(r => ({
        key: r.rate_key || r.key,
        label: r.label,
        kind: r.kind,
        per: r.per,
        amount: r.amount ?? r.default_amount,
        own: Boolean(r.is_own_rate),
      })))
    }

    load()
    return () => { live = false }
  }, [installerId])

  const base = rows.filter(r => r.kind === 'base')
  const extra = rows.filter(r => r.kind === 'extra')

  return (
    <details className="rate-card">
      <summary>
        Installer rate card{installerName ? `: ${installerName}` : ''}
      </summary>

      <p className="field-hint rate-card-note">
        What the install side of a job costs us. The pay box above offers the line
        that matches this job's build sheet; anything typed over it stands.
        {installerId
          ? ''
          : ' No installer is picked yet, so these are the rates a new installer starts on.'}
      </p>

      {error && <p className="form-error" role="alert">{error}</p>}

      <h3 className="rate-card-heading">Base, one per job</h3>
      <RateList rates={base} />

      <h3 className="rate-card-heading">Extras, on top of the base</h3>
      <RateList rates={extra} />
    </details>
  )
}

// A dl rather than a table: two columns of label and price is a description
// list, and it stays readable on a phone where a table would scroll sideways.
function RateList({ rates }) {
  if (rates.length === 0) {
    return <p className="field-hint">Nothing on this half of the card yet.</p>
  }

  return (
    <dl className="rate-card-list">
      {rates.map(rate => (
        <div className="rate-card-row" key={rate.key}>
          <dt>{rate.label}</dt>
          <dd>{rateLine(rate)}</dd>
        </div>
      ))}
    </dl>
  )
}
