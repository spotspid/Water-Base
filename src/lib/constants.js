// Structural constants only. Anything an operator would reasonably want to
// change now lives in the database and is edited on the Settings page:
// inventory categories, service cities, faucet finishes, payment types,
// transaction types, installer pay rate and the default stock location.
//
// What is left here is load bearing rather than operational. Job status is a
// check constraint on the jobs table that the install functions branch on,
// and each pick source needs a matching branch in the SQL function
// resolve_template_parts, so both are code changes rather than settings.

// A template line can defer one part to the customer. pick_source names the
// job field that carries the choice, pick_category narrows which inventory
// items are candidates, and the match is made on inventory_items.variant.
// Adding a source here also needs a matching branch in the SQL function
// resolve_template_parts.
export const PICK_SOURCES = [
  {
    value: 'faucet_finish',
    label: 'Faucet Finish',
    jobField: 'faucet_finish',
    defaultCategory: 'Faucet',
    help: 'Resolves to the item whose variant matches the finish chosen on the job.',
  },
  {
    value: 'ro_type',
    label: 'RO Type',
    jobField: 'ro_type',
    defaultCategory: 'RO',
    help: 'Resolves to the item whose variant matches the RO type chosen on the job. '
      + 'Both cost the same, so this is a choice rather than an upgrade.',
  },
  {
    value: 'valve_type',
    label: 'Valve Type',
    jobField: 'valve_type',
    defaultCategory: 'Valve',
    help: 'Resolves to the control valve whose variant matches the type chosen on the job. '
      + 'Valve items cost zero, because the valve is already inside the system price.',
  },
]

export const PICK_SOURCE_LABELS = {
  faucet_finish: 'Faucet Finish',
  ro_type: 'RO Type',
  valve_type: 'Valve Type',
}

export const STATUS_LABELS = {
  sold: 'Sold',
  scheduled: 'Scheduled',
  installed: 'Installed',
  cancelled: 'Cancelled',
}

// A cancelled job is history. It holds no reservation, it consumes no parts
// and it earns nothing, so the money totals leave it out while the pipeline
// breakdown still counts it.
export const CANCELLED_STATUS = 'cancelled'

// The statuses that hold a live claim on inventory. A job in one of these is
// booked but not yet installed, so its parts are committed rather than
// consumed. This mirrors the branch in sync_job_reservations.
export const RESERVING_STATUSES = ['sold', 'scheduled']

