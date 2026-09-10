import { Link } from 'react-router-dom'
import { formatCurrency, formatDay } from '../lib/inventory'
import { rateLabel, serviceLabel, worstFirst } from '../lib/warranty'

// The three tables on the warranty page. The page loads and decides what to
// show; these only lay a list out.

function Head({ title, note, count }) {
  return (
    <header className="dash-panel-head">
      <h2>{title}</h2>
      <span className="dash-panel-note">{note}</span>
      <span className="set-count">{count}</span>
    </header>
  )
}

export function WarrantyBySku({ rows }) {
  const ranked = worstFirst(rows, 'sku')

  return (
    <section className="dash-panel">
      <Head title="By part" note="Failures against units installed" count={ranked.length} />
      <div className="table-wrap">
        <table className="jobs-table">
          <thead>
            <tr>
              <th>Part</th>
              <th className="col-num">Failed</th>
              <th className="col-num">Installed</th>
              <th className="col-num">Rate</th>
              <th className="col-num">Cost</th>
              <th>First</th>
              <th>Last</th>
              <th>Bought from</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(r => (
              <tr key={r.item_id}>
                <td className="td-customer">
                  {r.sku}
                  <span className="cell-sub">{r.item_name}{r.variant ? ` (${r.variant})` : ''}</span>
                </td>
                <td className="col-num">{r.failures}</td>
                <td className="col-num">{r.units_installed}</td>
                <td className="col-num">
                  {r.failure_rate_pct == null
                    ? <span className="cell-unset" title="No installs recorded for this part">no base</span>
                    : rateLabel(r.failure_rate_pct)}
                </td>
                <td className="col-num col-value">{formatCurrency(r.cost)}</td>
                <td className="col-nowrap">{formatDay(r.first_failed_on)}</td>
                <td className="col-nowrap">{formatDay(r.last_failed_on)}</td>
                <td>{r.suppliers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function WarrantyBySupplier({ rows }) {
  const ranked = worstFirst(rows, 'supplier')

  return (
    <section className="dash-panel">
      <Head title="By supplier" note="Failures against units received from them" count={ranked.length} />
      <div className="table-wrap">
        <table className="jobs-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th className="col-num">Failed</th>
              <th className="col-num">Received</th>
              <th className="col-num">Rate</th>
              <th className="col-num">Cost</th>
              <th>First</th>
              <th>Last</th>
              <th>Parts</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(r => (
              <tr key={r.supplier}>
                <td className="td-customer">{r.supplier}</td>
                <td className="col-num">{r.failures}</td>
                <td className="col-num">{r.units_received}</td>
                <td className="col-num">
                  {r.failure_rate_pct == null
                    ? <span className="cell-unset" title="Nothing received from this supplier on a tracked order">no base</span>
                    : rateLabel(r.failure_rate_pct)}
                </td>
                <td className="col-num col-value">{formatCurrency(r.cost)}</td>
                <td className="col-nowrap">{formatDay(r.first_failed_on)}</td>
                <td className="col-nowrap">{formatDay(r.last_failed_on)}</td>
                <td>{r.skus_list}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function WarrantyEvents({ rows }) {
  return (
    <section className="dash-panel">
      <Head title="Every replacement" note="Newest first, traced to the install" count={rows.length} />
      <div className="table-wrap">
        <table className="jobs-table">
          <thead>
            <tr>
              <th>Replaced</th>
              <th>Part</th>
              <th className="col-num">Units</th>
              <th className="col-num">Cost</th>
              <th>Original install</th>
              <th>In service</th>
              <th>Bought from</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="col-nowrap">{formatDay(r.failed_at)}</td>
                <td className="td-customer">
                  {r.sku}
                  <span className="cell-sub">{r.item_name}{r.variant ? ` (${r.variant})` : ''}</span>
                </td>
                <td className="col-num">{r.units}</td>
                <td className="col-num col-value">{formatCurrency(r.cost)}</td>
                <td className="td-customer">
                  {r.warranty_job_id
                    ? <Link to={`/jobs?job=${r.warranty_job_id}`} className="tpl-link">{r.customer_name}</Link>
                    : <span className="cell-unset">Job no longer exists</span>}
                  <span className="cell-sub">
                    {r.system_template}
                    {r.install_date ? `, installed ${formatDay(r.install_date)}` : ''}
                    {r.installer_name ? ` by ${r.installer_name}` : ''}
                  </span>
                </td>
                <td className="col-nowrap">{serviceLabel(r.days_in_service)}</td>
                <td>
                  {r.supplier}
                  {r.supplier_order_number && <span className="cell-sub">{r.supplier_order_number}</span>}
                </td>
                <td>{r.note || r.reference || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
