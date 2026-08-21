import { FIELD_LABELS, REQUIRED_FIELDS } from '../lib/importPipeline'

const FIELDS = ['spent_on', 'amount', 'vendor', 'description']

const FIELD_HINTS = {
  spent_on: 'When the money was spent.',
  amount: 'What it cost. Currency symbols and commas are fine.',
  vendor: 'Who was paid. Used for the duplicate check.',
  description: 'Anything extra worth keeping.',
}

// Step two of the import. Points the producer's columns at the four fields
// the expenses table stores, and picks the category the batch lands under.
export default function ImportMapStep({
  columns, rows, mapping, onMapping,
  categories, category, onCategory,
  flipSigns, onFlipSigns,
  disabled,
}) {
  const sample = rows.slice(0, 3)

  return (
    <div className="imp-step">
      <p className="imp-lede">
        {rows.length} {rows.length === 1 ? 'row' : 'rows'} read. Match the columns to
        the fields below. Date and amount are required, the other two are optional.
      </p>

      <div className="form-grid">
        {FIELDS.map(field => (
          <div className="field" key={field}>
            <label htmlFor={`map-${field}`}>
              {FIELD_LABELS[field]}
              {!REQUIRED_FIELDS.includes(field) && <span className="optional"> (optional)</span>}
            </label>
            <select
              id={`map-${field}`}
              value={mapping[field]}
              disabled={disabled}
              onChange={e => onMapping({ ...mapping, [field]: e.target.value })}
            >
              <option value="">Not mapped</option>
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="field-hint">{FIELD_HINTS[field]}</span>
          </div>
        ))}

        <div className="field">
          <label htmlFor="map-category">Category for this batch</label>
          <select
            id="map-category"
            value={category}
            disabled={disabled}
            onChange={e => onCategory(e.target.value)}
          >
            <option value="">Select category...</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="field-hint">
            Applied to every row. Individual rows can be recategorised after the import.
          </span>
        </div>

        <div className="field field-checkbox">
          <label htmlFor="map-flip">
            <input
              id="map-flip"
              type="checkbox"
              checked={flipSigns}
              disabled={disabled}
              onChange={e => onFlipSigns(e.target.checked)}
            />
            Flip the sign on every amount
          </label>
          <span className="field-hint">
            For exports that list spending as a negative number.
          </span>
        </div>
      </div>

      {sample.length > 0 && (
        <div>
          <p className="imp-sample-title">First {sample.length} rows as read</p>
          <div className="table-wrap">
            <table className="jobs-table imp-table">
              <thead>
                <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {sample.map((row, i) => (
                  <tr key={i}>
                    {columns.map(c => <td key={c} className="col-note">{row[c]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
