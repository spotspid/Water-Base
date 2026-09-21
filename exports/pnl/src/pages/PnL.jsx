import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { formatCurrency, formatMonth, monthsAgoIso, todayIso } from '../lib/expenses'
import { GROSS, NET } from '../lib/profit'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import StatGrid from '../components/StatGrid'
import PnlCategories from '../components/PnlCategories'
import '../styles/base.css'
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
  const [categoryError, setCategoryError] = useState('')
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
          .select('month, revenue, cost_of_sales, expense_total, sale_count, '
            + 'expense_count, gross_profit, net_profit')
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
      setCategoryError('')
    } else {
      setMonths(summaryRes.data || [])
      // A failed breakdown used to become an empty list, which the category
      // card read as no expenses in the range. Kept apart so it can say so.
      setCategoryError(categoryRes.error || '')
      setCategories(categoryRes.error ? [] : (categoryRes.data || []))
    }

    setLoading(false)
  }, [fromMonth, toMonth])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => months.reduce((acc, m) => ({
    revenue: acc.revenue + Number(m.revenue),
    cost_of_sales: acc.cost_of_sales + Number(m.cost_of_sales),
    expense_total: acc.expense_total + Number(m.expense_total),
    gross_profit: acc.gross_profit + Number(m.gross_profit),
    net_profit: acc.net_profit + Number(m.net_profit),
    sale_count: acc.sale_count + Number(m.sale_count),
  }), {
    revenue: 0, cost_of_sales: 0, expense_total: 0,
    gross_profit: 0, net_profit: 0, sale_count: 0,
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
              <code>pnl_expense_categories</code> views. If those are missing, run
              {' '}<code>schema.sql</code> from this folder and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {hasData && months.length > 0 && (
          <StatGrid count={5} className="inv-summary pnl-summary">
            <div className="inv-stat">
              <span className="inv-stat-label">Revenue</span>
              <span className="inv-stat-value">{formatCurrency(totals.revenue)}</span>
              <span className="inv-stat-note">
                {totals.sale_count} {totals.sale_count === 1 ? 'sale' : 'sales'}
              </span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Cost of sales</span>
              <span className="inv-stat-value pnl-cost">{formatCurrency(totals.cost_of_sales)}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">{GROSS}</span>
              <span className="inv-stat-value">{formatCurrency(totals.gross_profit)}</span>
              <span className="inv-stat-note">Before overheads</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Expenses</span>
              <span className="inv-stat-value pnl-cost">{formatCurrency(totals.expense_total)}</span>
            </div>
            <div className={totals.net_profit < 0 ? 'inv-stat inv-stat-alert pnl-net' : 'inv-stat inv-stat-lead pnl-net'}>
              <span className="inv-stat-label">{NET}</span>
              <span className="inv-stat-value">{formatCurrency(totals.net_profit)}</span>
              <span className="inv-stat-note">{GROSS} less overheads</span>
            </div>
          </StatGrid>
        )}

        {hasData && months.length === 0 && (
          <EmptyState title="Nothing in this range">
            <p>
              A month appears here once a sale or an expense is dated in it. Widen the
              range above, or record the first sale or expense.
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
                  <th className="col-num">Cost of sales</th>
                  <th className="col-num">Expenses</th>
                  <th className="col-num">{NET}</th>
                  <th className="col-num">Sales</th>
                </tr>
              </thead>
              <tbody>
                {months.map(row => (
                  <tr key={row.month}>
                    <td className="td-customer col-nowrap">{formatMonth(row.month)}</td>
                    <td className="col-num">{formatCurrency(row.revenue)}</td>
                    <td className="col-num pnl-cost">{formatCurrency(row.cost_of_sales)}</td>
                    <td className="col-num pnl-cost">{formatCurrency(row.expense_total)}</td>
                    <td className={Number(row.net_profit) < 0 ? 'col-num col-value qty-out' : 'col-num col-value qty-in'}>
                      {formatCurrency(row.net_profit)}
                    </td>
                    <td className="col-num">{row.sale_count}</td>
                  </tr>
                ))}
                <tr className="pnl-total-row">
                  <td className="td-customer">Range total</td>
                  <td className="col-num col-value">{formatCurrency(totals.revenue)}</td>
                  <td className="col-num col-value pnl-cost">{formatCurrency(totals.cost_of_sales)}</td>
                  <td className="col-num col-value pnl-cost">{formatCurrency(totals.expense_total)}</td>
                  <td className={totals.net_profit < 0 ? 'col-num col-value qty-out' : 'col-num col-value qty-in'}>
                    {formatCurrency(totals.net_profit)}
                  </td>
                  <td className="col-num col-value">{totals.sale_count}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {hasData && months.length > 0 && (
          <p className="inv-ledger-note">
            Revenue counts a sale in the month of its sale date, whether or not it has been
            paid, because that is when it was earned. Cost of sales is the cost recorded on
            each sale. Expenses are everything else, grouped by category below.
          </p>
        )}

        {hasData && months.length > 0 && (
          <PnlCategories months={monthKeys} rows={categories}
            loadError={categoryError} onRetry={load} />
        )}
      </div>
    </AppShell>
  )
}
