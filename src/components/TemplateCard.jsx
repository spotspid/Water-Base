import { useMemo, useState } from 'react'
import { formatCurrency } from '../lib/inventory'
import { lineDetail, lineLabel, templateCost, unsupportedPicks } from '../lib/templates'
import { useSettings } from '../lib/settings'

export default function TemplateCard({
  template, lines, items, onEditTemplate, onAddLine, onEditLine, onDeleteLine,
}) {
  const { finishes, roTypes, valveTypes } = useSettings()
  const [confirmingId, setConfirmingId] = useState('')

  const cost = useMemo(() => templateCost(lines, items), [lines, items])

  // Each pick line is checked against its own list: faucet lines against the
  // finishes, RO lines against the RO types. One warning per list with a gap.
  const gaps = useMemo(
    () => unsupportedPicks(lines, items, {
      faucet_finish: finishes, ro_type: roTypes, valve_type: valveTypes,
    }),
    [lines, items, finishes, roTypes, valveTypes],
  )

  const price = template.default_price == null ? null : Number(template.default_price)
  const marginAtLow = price == null ? null : price - cost.high

  return (
    <section className={template.active ? 'tpl-card' : 'tpl-card tpl-card-inactive'}>
      <header className="tpl-card-head">
        <div className="tpl-card-titles">
          <h2>
            {template.label}
            {!template.active && <span className="inv-inactive">Inactive</span>}
          </h2>
          <p className="tpl-card-meta">
            {price == null ? 'Price set per job' : `${formatCurrency(price)} default price`}
            {' · '}
            {lines.length} {lines.length === 1 ? 'part' : 'parts'}
            {lines.length > 0 && (
              <>
                {' · '}
                {cost.isRange
                  ? `${formatCurrency(cost.low)} to ${formatCurrency(cost.high)} parts cost`
                  : `${formatCurrency(cost.low)} parts cost`}
              </>
            )}
            {marginAtLow != null && lines.length > 0 && (
              <>{' · '}{formatCurrency(marginAtLow)} margin before installer pay</>
            )}
          </p>
          {template.notes && <p className="tpl-card-notes">{template.notes}</p>}
        </div>
        <div className="tpl-card-actions">
          <button type="button" className="btn-cancel" onClick={onEditTemplate}>Edit</button>
          <button
            type="button"
            className="btn-primary"
            onClick={onAddLine}
            disabled={items.length === 0}
          >
            + Add part
          </button>
        </div>
      </header>

      {gaps.map(gap => (
        <p className="form-warning" role="status" key={gap.source}>
          No active {gap.category} item matches {gap.missing.length === 1 ? 'this' : 'these'}
          {' '}{gap.label.toLowerCase()}{gap.missing.length === 1 ? '' : 's'}: {gap.missing.join(', ')}.
          A job using {gap.missing.length === 1 ? 'it' : 'one of them'} will refuse to install
          until the item exists.
        </p>
      ))}

      {cost.unpricedPickLines > 0 && (
        <p className="form-warning" role="status">
          {cost.unpricedPickLines} customer pick {cost.unpricedPickLines === 1 ? 'line has' : 'lines have'}
          {' '}no candidate items at all, so the parts cost shown excludes them.
        </p>
      )}

      {lines.length === 0 && (
        <p className="tpl-empty">
          No parts yet. A job on this template will install without deducting anything.
        </p>
      )}

      {lines.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Detail</th>
                <th className="col-num">Qty</th>
                <th className="col-num">Unit Cost</th>
                <th className="col-num">Line Cost</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line.id}>
                  <td className="td-customer">
                    {lineLabel(line)}
                    {line.line_type === 'customer_pick' && (
                      <span className="tpl-pick-badge">Customer pick</span>
                    )}
                  </td>
                  <td className="tpl-detail">
                    {lineDetail(line)}
                    {line.note && <span className="tpl-line-note">{line.note}</span>}
                  </td>
                  <td className="col-num">{line.quantity}</td>
                  <td className="col-num">
                    {line.line_type === 'customer_pick'
                      ? <span className="tpl-varies">varies</span>
                      : formatCurrency(line.unit_cost)}
                  </td>
                  <td className="col-num col-value">
                    {line.line_type === 'customer_pick'
                      ? <span className="tpl-varies">varies</span>
                      : formatCurrency(line.line_cost)}
                  </td>
                  <td className="col-actions">
                    {confirmingId === line.id ? (
                      <span className="tpl-confirm">
                        <button type="button" className="tpl-danger" onClick={() => onDeleteLine(line)}>
                          Remove
                        </button>
                        <button type="button" className="tpl-link" onClick={() => setConfirmingId('')}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="tpl-confirm">
                        <button type="button" className="tpl-link" onClick={() => onEditLine(line)}>
                          Edit
                        </button>
                        <button type="button" className="tpl-link" onClick={() => setConfirmingId(line.id)}>
                          Remove
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
