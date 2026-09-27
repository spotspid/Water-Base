import { NO_RO } from '../lib/roPicks'

// Who the job is for and what was sold, at the top of the drawer.
//
// The three picks were the reason this exists. Faucet finish, RO type and
// valve type decide which parts leave the shelf and what the documents say,
// and none of them was visible in the drawer at all: you opened the edit form
// to find out what had been chosen, then closed it again. They are read here
// and edited in one place, together, because they are one decision about one
// system.
//
// Everything is a value beside a label. A job is read far more often than it
// is changed, and a drawer of live boxes invites a change nobody meant.
export default function JobSystemSummary({ job, onEdit }) {
  const noRo = job.ro_type === NO_RO
  const where = [job.address, job.city].filter(Boolean).join(', ')

  return (
    <section className="agr-panel">
      <div className="agr-head">
        <div>
          <h3>Customer and system</h3>
          <p className="agr-sub">{where || 'No address on this job'}</p>
        </div>
        <button type="button" className="btn-cancel" onClick={onEdit}>Edit</button>
      </div>

      <div className="form-grid">
        <Value label="Phone" value={job.phone} />
        <Value label="Email" value={job.customer_email} missing="None, so nothing can be sent" />
        <Value label="Water source" value={job.water_source === 'well' ? 'Well' : 'City'} />

        <Value label="Build sheet" value={job.system_template} />
        <Value label="Faucet finish" value={noRo ? 'N/A, no RO' : job.faucet_finish} />
        <Value label="RO type" value={job.ro_type} />
        <Value label="Valve type" value={job.valve_type} missing="Not chosen" />
        <Value label="Payment type" value={job.payment_type} />
        <Value label="Invoice number" value={job.invoice_number} />
      </div>

      {job.system_long_name && (
        <p className="agr-sub">{job.system_long_name}</p>
      )}
    </section>
  )
}

function Value({ label, value, missing = 'Not set' }) {
  const shown = String(value ?? '').trim()

  return (
    <div className="field">
      <span className="inv-stat-label">{label}</span>
      <span className="inv-stat-value">
        {shown || <span className="cell-unset">{missing}</span>}
      </span>
    </div>
  )
}
