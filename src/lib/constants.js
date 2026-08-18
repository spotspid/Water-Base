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
]

export const PICK_SOURCE_LABELS = {
  faucet_finish: 'Faucet Finish',
}

export const STATUS_LABELS = {
  sold: 'Sold',
  scheduled: 'Scheduled',
  installed: 'Installed',
}

