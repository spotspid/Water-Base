import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { formatCurrency } from '../lib/inventory'
import { warrantyTotals } from '../lib/warranty'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import { WarrantyBySku, WarrantyBySupplier, WarrantyEvents } from '../components/WarrantyTables'
import './Warranty.css'

// Failures by part and by supplier, so the failure rate is a number.
//
// Three views, one page. The events are the record; the two summaries are
// the same rows counted two ways, and the database does the counting so this
// page and any query somebody runs by hand agree.
const EVENT_COLUMNS =
  'id, failed_at, failed_on, item_id, sku, item_name, variant, category, units, '
  + 'unit_cost_at_txn, cost, reference, note, warranty_job_id, customer_name, city, '
  + 'install_date, invoice_number, system_template, installer_name, days_in_service, '
  + 'supplier, supplier_order_number'

const SKU_COLUMNS =
  'item_id, sku, item_name, variant, category, events, failures, cost, first_failed_on, '
  + 'last_failed_on, units_installed, units_purchased, failure_rate_pct, suppliers'

const SUPPLIER_COLUMNS =
  'supplier, events, failures, cost, skus, first_failed_on, last_failed_on, '
  + 'units_received, failure_rate_pct, skus_list'

export default function Warranty() {
  const [events, setEvents] = useState([])
  const [bySku, setBySku] = useState([])
  const [bySupplier, setBySupplier] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const [eventRes, skuRes, supplierRes] = await Promise.all([
      attempt(
        () => supabase.from('warranty_replacements').select(EVENT_COLUMNS)
          .order('failed_at', { ascending: false }),
        'The warranty replacements could not be loaded.',
      ),
      attempt(
        () => supabase.from('warranty_by_sku').select(SKU_COLUMNS),
        'The failures by part could not be loaded.',
      ),
      attempt(
        () => supabase.from('warranty_by_supplier').select(SUPPLIER_COLUMNS),
        'The failures by supplier could not be loaded.',
      ),
    ])

    // One failure is the page's failure. Three tables that disagree about
    // whether the data exists would be worse than one message.
    const firstError = eventRes.error || skuRes.error || supplierRes.error

    if (firstError) {
      setError(firstError)
      setEvents([])
      setBySku([])
      setBySupplier([])
    } else {
      setEvents(eventRes.data || [])
      setBySku(skuRes.data || [])
      setBySupplier(supplierRes.data || [])
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => warrantyTotals(events), [events])
  const hasData = !loading && !error

  return (
    <AppShell
      subtitle={hasData && events.length > 0
        ? `${totals.units} ${totals.units === 1 ? 'unit' : 'units'} replaced across ${totals.skus} ${totals.skus === 1 ? 'part' : 'parts'}`
        : undefined}
      actions={(
        <button type="button" className="btn-cancel" onClick={load} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      )}
    >
      <div className="wty-page">
        {loading && <p className="inv-state">Loading warranty replacements...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">Warranty replacements could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              This page reads the <code>warranty_replacements</code>, <code>warranty_by_sku</code> and
              {' '}<code>warranty_by_supplier</code> views. If they are missing, apply the migrations
              in <code>supabase/migrations</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {hasData && events.length === 0 && (
          <EmptyState title="No warranty replacements yet">
            <p>
              When a part fails in the field and is replaced, log it from
              {' '}<Link to="/inventory" className="tpl-link">Inventory</Link> as a warranty
              replacement and pick the job it was installed on. It comes off the shelf at cost,
              and this page starts counting failures by part and by supplier.
            </p>
          </EmptyState>
        )}

        {hasData && events.length > 0 && (
          <>
            <div className="inv-summary">
              <div className="inv-stat inv-stat-lead">
                <span className="inv-stat-label">Units replaced</span>
                <span className="inv-stat-value">{totals.units}</span>
              </div>
              <div className="inv-stat">
                <span className="inv-stat-label">Replacements</span>
                <span className="inv-stat-value">{totals.events}</span>
              </div>
              <div className="inv-stat">
                <span className="inv-stat-label">Parts affected</span>
                <span className="inv-stat-value">{totals.skus}</span>
              </div>
              <div className="inv-stat">
                <span className="inv-stat-label">Cost to us</span>
                <span className="inv-stat-value">{formatCurrency(totals.cost)}</span>
              </div>
            </div>

            <WarrantyBySku rows={bySku} />
            <WarrantyBySupplier rows={bySupplier} />
            <WarrantyEvents rows={events} />

            <p className="inv-ledger-note">
              A replacement leaves the shelf at the catalogue cost on the day and is traced to
              the install it went in on, not charged to it: the margin recorded for that job stays
              what it was. The supplier is read off the order that brought the part in, so a part
              with no tracked order reads as Unknown.
            </p>
          </>
        )}
      </div>
    </AppShell>
  )
}
