import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { formatCurrency, formatMonth, monthsAgoIso, todayIso } from '../lib/expenses'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import PnlCategories from '../components/PnlCategories'
import './PnL.css'

// The range control works in whole months, because every number on this page
// is already grouped by month. Storing the endpoints as dates keeps the query
// simple and lets the view stay a plain group by.
function toMonthInput(iso) {
  return String(iso || '').slice(0, 7)
}

function monthStart(monthInput) {
  return `${monthInput}-01`
}

function monthEnd(monthInput) {
  const [y, m] = monthInput.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${monthInput}-${String(last).padStart(2, '0')}`
}

export default function PnL() {
  const [fromMonth, setFromMonth] = useState(toMonthInput(monthsAgoIso(5)))
  const [toMonth, setToMonth] = useState(toMonthInput(todayIso()))
  const [months, setMonths] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const start = monthStart(fromMonth)
    const end = monthEnd(toMonth)

    const [summaryRes, categoryRes] = await Promise.all([
      attempt(
        () => supabase.from('pnl_monthly')
          .select('month, revenue, parts_cost, installer_pay, expense_total, job_count, expense_count, net')
          .gte('month', start).lte('month', end)
          .order('month', { ascending: false }),
        'The profit and loss could not be loaded.',
      ),
      attempt(
        () => supabase.from('pnl_expense_categories')
          .select('month, category, total, expense_count')
          .gte('month', start).lte('month', end),
        'The category breakdown could not be loaded.',
      ),
    ])

    if (summaryRes.error) {
      setError(summaryRes.error)
      setMonths([])
      setCategories([])
    } else {
      setMonths(summaryRes.data || [])
      setCategories(categoryRes.error ? [] : (categoryRes.data || []))
    }

    setLoading(false)
  }, [fromMonth, toMonth])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => months.reduce((acc, m) => ({
    revenue: acc.revenue + Number(m.revenue),
    parts_cost: acc.parts_cost + Number(m.parts_cost),
    installer_pay: acc.installer_pay + Number(m.installer_pay),
    expense_total: acc.expense_total + Number(m.expense_total),
    net: acc.net + Number(m.net),
    job_count: acc.job_count + Number(m.job_count),
  }), {
    revenue: 0, parts_cost: 0, installer_pay: 0, expense_total: 0, net: 0, job_count: 0,
  }), [months])

  const monthKeys = useMemo(
    () => months.map(m => m.month).sort(),
    [months],
  )

  const rangeInvalid = fromMonth > toMonth
  const hasData = !loading && !error && !rangeInvalid

  return (
    <AppShell>
      <div className="pnl-page">
        <div className="inv-header">
          <h1>Profit and Loss</h1>
        </div>

        <div className="exp-filters">
          <div className="field">
            <label htmlFor="from-month">From</label>
            <input id="from-month" type="month" value={fromMonth}
              onChange={e => setFromMonth(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="to-month">To</label>
            <input id="to-month" type="month" value={toMonth}
              onChange={e => setToMonth(e.target.value)} />
          </div>
        </div>

        {rangeInvalid && (
          <p className="form-error" role="alert">
            The start month is after the end month. Swap them to see anything.
          </p>
        )}

        {loading && !rangeInvalid && <p className="inv-state">Loading the numbers...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">The profit and loss could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              This page reads the <code>pnl_monthly</code> and{' '}
              <code>pnl_expense_categories</code> views. If those are missing, apply
              {' '}<code>supabase/migrations/20260823000000_create_financials.sql</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {hasData && months.length > 0 && (
          <div className="pnl-summary">
            <div className="inv-stat">
              <span className="inv-stat-label">Revenue</span>
              <span className="inv-stat-value">{formatCurrency(totals.revenue)}</span>
              <span className="pnl-stat-note">{totals.job_count} installed</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Parts</span>
              <span className="inv-stat-value pnl-cost">{formatCurrency(totals.parts_cost)}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Installer Pay</span>
              <span className="inv-stat-value pnl-cost">{formatCurrency(totals.installer_pay)}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Expenses</span>
              <span className="inv-stat-value pnl-cost">{formatCurrency(totals.expense_total)}</span>
            </div>
            <div className={totals.net < 0 ? 'inv-stat inv-stat-alert pnl-net' : 'inv-stat inv-stat-lead pnl-net'}>
              <span className="inv-stat-label">Net</span>
              <span className="inv-stat-value">{formatCurrency(totals.net)}</span>
            </div>
          </div>
        )}

        {hasData && months.length === 0 && (
          <EmptyState title="Nothing in this range">
            <p>
              A month appears here once a job is marked installed in it, or an expense is
              dated in it. Widen the range above, or add the first expense.
            </p>
          </EmptyState>
        )}

        {hasData && months.length > 0 && (
          <div className="table-wrap">
            <table className="jobs-table pnl-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="col-num">Revenue</th>
                  <th className="col-num">Parts</th>
                  <th className="col-num">Installer Pay</th>
                  <th className="col-num">Expenses</th>
                  <th className="col-num">Net</th>
                  <th className="col-num">Jobs</th>
                </tr>
              </thead>
              <tbody>
                {months.map(row => (
                  <tr key={row.month}>
                    <td className="td-customer col-nowrap">{formatMonth(row.month)}</td>
                    <td className="col-num">{formatCurrency(row.revenue)}</td>
                    <td className="col-num pnl-cost">{formatCurrency(row.parts_cost)}</td>
                    <td className="col-num pnl-cost">{formatCurrency(row.installer_pay)}</td>
                    <td className="col-num pnl-cost">{formatCurrency(row.expense_total)}</td>
                    <td className={Number(row.net) < 0 ? 'col-num col-value qty-out' : 'col-num col-value qty-in'}>
                      {formatCurrency(row.net)}
                    </td>
                    <td className="col-num">{row.job_count}</td>
                  </tr>
                ))}
                <tr className="pnl-total-row">
                  <td className="td-customer">Range total</td>
                  <td className="col-num col-value">{formatCurrency(totals.revenue)}</td>
                  <td className="col-num col-value pnl-cost">{formatCurrency(totals.parts_cost)}</td>
                  <td className="col-num col-value pnl-cost">{formatCurrency(totals.installer_pay)}</td>
                  <td className="col-num col-value pnl-cost">{formatCurrency(totals.expense_total)}</td>
                  <td className={totals.net < 0 ? 'col-num col-value qty-out' : 'col-num col-value qty-in'}>
                    {formatCurrency(totals.net)}
                  </td>
                  <td className="col-num col-value">{totals.job_count}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {hasData && months.length > 0 && (
          <p className="inv-ledger-note">
            Revenue counts a job in the month it was installed. Parts cost is summed from
            the inventory ledger at the cost recorded on each transaction, and installer
            pay is the amount entered on the job.
          </p>
        )}

        {hasData && months.length > 0 && (
          <PnlCategories months={monthKeys} rows={categories} />
        )}
      </div>
    </AppShell>
  )
}
