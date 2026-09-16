import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { formatCurrency } from '../lib/inventory'
import { formatLongDate } from '../lib/schedule'
import {
  OWED_STATES, outstandingTotals, owedForLabel, sortOutstanding,
} from '../lib/outstanding'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import './Outstanding.css'

// What is owed across every job, in both directions.
//
// Revenue on the profit and loss is earned when the work is done. This page
// is the other half: of what was earned or agreed, what has not arrived. The
// state each job is in comes from outstanding_balances in the database, so the
// page and the profit and loss cannot disagree about who owes what.
const COLUMNS =
  'job_id, customer_name, city, status, system_template, invoice_number, scheduled_date, '
  + 'install_date, sale_price, deposit_amount, deposit_outstanding, paid, payment_count, '
  + 'last_payment_on, balance_due, owed_state, amount_owed, days_since_install'

function dateOf(value) {
  return value ? formatLongDate(String(value).slice(0, 10)) : ''
}

// The one line under the customer's name that says why they are on the list.
function detailOf(row) {
  const paid = Number(row.paid) || 0
  const received = paid > 0 ? `${formatCurrency(paid)} received` : 'nothing received'

  switch (row.owed_state) {
    case 'owed_now':
      return `${owedForLabel(row.days_since_install)}, ${received} of ${formatCurrency(row.sale_price)}`
    case 'deposit_due':
      return `Deposit ${formatCurrency(row.deposit_amount)} agreed, ${received}`
        + (row.scheduled_date ? `, installing ${dateOf(row.scheduled_date)}` : '')
    case 'on_completion':
      return `${received} of ${formatCurrency(row.sale_price)}`
        + (row.scheduled_date ? `, installing ${dateOf(row.scheduled_date)}` : ', not scheduled')
    case 'owed_back':
      return row.status === 'cancelled'
        ? `Cancelled, ${received}`
        : `${received} on a price of ${formatCurrency(row.sale_price)}`
    default:
      return ''
  }
}

export default function Outstanding() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => supabase.from('outstanding_balances').select(COLUMNS),
      'What is outstanding could not be loaded.',
    )

    if (err) {
      setError(err)
      setRows([])
    } else {
      setRows(data || [])
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => sortOutstanding(rows), [rows])
  const totals = useMemo(() => outstandingTotals(rows), [rows])
  const hasData = !loading && !error

  return (
    <AppShell
      subtitle={hasData && rows.length > 0
        ? `${formatCurrency(totals.collectableNow)} collectable now`
        : undefined}
      actions={(
        <button type="button" className="btn-cancel" onClick={load} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      )}
    >
      <div className="out-page">
        {loading && <p className="inv-state">Loading what is outstanding...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">What is outstanding could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              This page reads the <code>outstanding_balances</code> view. If it is missing,
              apply the migrations in <code>supabase/migrations</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {hasData && rows.length === 0 && (
          <EmptyState title="Nothing outstanding">
            <p>
              Every job is paid to its price, and nothing is owed back. A job appears here the
              moment a deposit is agreed and not received, or it installs without being paid
              in full.
            </p>
          </EmptyState>
        )}

        {hasData && rows.length > 0 && (
          <>
            <div className="inv-summary">
              {OWED_STATES.map(state => {
                const bucket = totals.byState[state.key]
                const urgent = state.key === 'owed_now' && bucket.amount > 0
                return (
                  <div key={state.key}
                    className={urgent ? 'inv-stat inv-stat-alert' : 'inv-stat'}>
                    <span className="inv-stat-label">{state.label}</span>
                    <span className="inv-stat-value">{formatCurrency(bucket.amount)}</span>
                    <span className="inv-stat-note">
                      {bucket.count} {bucket.count === 1 ? 'job' : 'jobs'}
                    </span>
                  </div>
                )
              })}
            </div>

            {OWED_STATES.map(state => {
              const group = sorted.filter(r => r.owed_state === state.key)
              if (group.length === 0) return null

              return (
                <section className="dash-panel" key={state.key}>
                  <header className="dash-panel-head">
                    <h2>{state.label}</h2>
                    <span className="dash-panel-note">{state.hint}</span>
                    <span className="set-count">{formatCurrency(totals.byState[state.key].amount)}</span>
                  </header>

                  <div className="table-wrap">
                    <table className="jobs-table">
                      <thead>
                        <tr>
                          <th>Customer</th>
                          <th>System</th>
                          <th className="col-num">{state.direction === 'out' ? 'Owed back' : 'Owed'}</th>
                          <th className="col-num">Balance</th>
                          <th>Last payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.map(row => (
                          <tr key={row.job_id}>
                            <td className="td-customer">
                              <Link to={`/jobs?job=${row.job_id}`} className="tpl-link">
                                {row.customer_name}
                              </Link>
                              <span className="cell-sub">{detailOf(row)}</span>
                            </td>
                            <td>
                              {row.system_template}
                              {row.invoice_number && <span className="cell-sub">{row.invoice_number}</span>}
                            </td>
                            <td className={state.key === 'owed_now'
                              ? 'col-num col-value qty-out' : 'col-num col-value'}>
                              {formatCurrency(row.amount_owed)}
                            </td>
                            <td className="col-num">{formatCurrency(row.balance_due)}</td>
                            <td className="col-nowrap">
                              {row.last_payment_on
                                ? dateOf(row.last_payment_on)
                                : <span className="cell-unset">none</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )
            })}

            <p className="inv-ledger-note">
              Owed is what should change hands next: the whole balance on an installed job, what
              is left of the deposit on a job not yet installed, or the rest of the price when it
              is done. Balance is the sale price less every payment, whatever each one was for.
              Collectable now is owed now plus deposits due, and leaves out work that has not
              been done yet.
            </p>
          </>
        )}
      </div>
    </AppShell>
  )
}
