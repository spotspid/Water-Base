// The panel that holds the number somebody is about to say out loud.
//
// Lines are typed, not picked. Most of what Michigan Water Pros sells is
// custom, so a fixed list of extras at fixed prices would be a form to fight
// rather than a form to fill: the catalogue below is a shortcut that fills in
// a line, and every figure stays editable afterwards.
export default function QuoteTotals({
  lines, total, incomplete, price, onPriceChange,
  onAddLine, onChangeLine, onRemoveLine, catalogue, deposit, onDepositChange, busy,
}) {
  return (
    <div className="quote-totals">
      <h2 className="quote-totals-head">Quote</h2>

      <div className="field">
        <label htmlFor="quote-price">System price</label>
        <input
          id="quote-price" name="sale_price" type="text" inputMode="decimal"
          value={price} onChange={onPriceChange} disabled={busy}
          placeholder="Type the price"
        />
        <span className="quote-hint">A preset fills this in. Type over it for anything custom.</span>
      </div>

      {lines.length > 0 && (
        <ul className="quote-lines">
          {lines.map((line, index) => (
            <li key={line.key} className="quote-line">
              <input
                type="text" aria-label={`Line ${index + 1} description`}
                value={line.label} disabled={busy}
                onChange={e => onChangeLine(index, { label: e.target.value })}
                placeholder="What is it"
              />
              <input
                type="text" inputMode="decimal" aria-label={`Line ${index + 1} amount`}
                className="quote-line-amount" value={line.price} disabled={busy}
                onChange={e => onChangeLine(index, { price: e.target.value })}
                placeholder="0.00"
              />
              <button
                type="button" className="quote-line-remove" disabled={busy}
                onClick={() => onRemoveLine(index)}
                aria-label={`Remove ${line.label || `line ${index + 1}`}`}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="quote-add">
        <button type="button" className="tpl-link" onClick={() => onAddLine()} disabled={busy}>
          Add a line
        </button>
        {catalogue.length > 0 && (
          <>
            <span className="quote-add-sep" aria-hidden="true">or</span>
            {catalogue.map(item => (
              <button
                key={item.id} type="button" className="tpl-link" disabled={busy}
                onClick={() => onAddLine({ label: item.label, price: item.price ?? '' })}
              >
                {item.label}
              </button>
            ))}
          </>
        )}
      </div>

      <div className="quote-sum">
        <span>Total</span>
        <strong>{total === '' ? 'Not priced yet' : total}</strong>
      </div>

      {incomplete && (
        <p className="quote-warn" role="status">
          Something on this quote has no price, so the figure above is only what is known.
          It is not the price of the job.
        </p>
      )}

      <div className="field">
        <label htmlFor="quote-deposit">Deposit <span className="optional">(optional)</span></label>
        <input
          id="quote-deposit" name="deposit_amount" type="text" inputMode="decimal"
          value={deposit} onChange={onDepositChange} disabled={busy}
          placeholder="Leave blank if none is agreed"
        />
        <span className="quote-hint">Blank means nothing was agreed, which is not the same as zero.</span>
      </div>
    </div>
  )
}
