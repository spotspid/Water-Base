import { BASE_RATES, EXTRA_RATES, rateAmount } from '../lib/installRates'

// The installer rate card, on the quote form, to read and not to fill in.
//
// Closed by default. It answers a question that only comes up sometimes, and
// left open it would push the rest of the form down the page for everyone who
// already knows the numbers.
//
// A details element rather than state and a button, so it opens with the
// keyboard, prints open in a browser that expands details for print, and finds
// its own text under a page search even while it is shut.
export default function InstallRateCard() {
  return (
    <details className="rate-card">
      <summary>Installer rate card</summary>

      <p className="field-hint rate-card-note">
        What the install side of a job costs us. Reference only: this does not
        set installer pay, which is typed on the job.
      </p>

      <h3 className="rate-card-heading">Base, one per job</h3>
      <RateList rates={BASE_RATES} />

      <h3 className="rate-card-heading">Extras, on top of the base</h3>
      <RateList rates={EXTRA_RATES} />
    </details>
  )
}

// A dl rather than a table: two columns of label and price is a description
// list, and it stays readable on a phone where a table would scroll sideways.
function RateList({ rates }) {
  return (
    <dl className="rate-card-list">
      {rates.map(rate => (
        <div className="rate-card-row" key={rate.id}>
          <dt>{rate.label}</dt>
          <dd>
            {rateAmount(rate)}
            {rate.per && <span className="rate-card-per"> {rate.per}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
