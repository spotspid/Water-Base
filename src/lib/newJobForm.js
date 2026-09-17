// Validation for the New job and New quote form.
//
// Moved out of NewJob.jsx so the page stays about state and submission, and so
// the rules can be read without scrolling past markup. The sales checklist
// validates separately, in salesChecklist.js, because its rule is different:
// a blank there is allowed and shows amber, where a blank here stops the save.
//
// Pure and importing nothing.

// sending is true for Save and send quote. A quote goes out by email, so only
// that button needs the customer email, and only a job still Quoted can be sent
// as a quote. Save quote never sends and needs neither.
export function validateNewJob(form, { sending = false, selectedTemplate = null } = {}) {
  if (!form.customer_name.trim()) return 'Customer name is required.'
  if (!form.phone.trim()) return 'Phone is required.'
  if (!form.address.trim()) return 'Address is required.'

  // optional, but a typo here means the agreement silently never arrives
  const email = form.customer_email.trim()
  if (sending && form.status !== 'quoted') {
    return 'Only a quote can be sent. Set the status to Quoted, or use Save quote.'
  }
  if (sending && !email) {
    return 'A quote is sent by email, so the customer email is required.'
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'That email address does not look right.'
  }

  if (!form.city.trim()) return 'Enter a city.'
  if (!form.system_template) return 'Pick a build sheet.'
  // On a quote these three are part of the sales checklist, where a blank is
  // allowed and shows amber: the finish is often not decided at the kitchen
  // table. A sold or booked job still needs them, because its parts do.
  if (form.status !== 'quoted') {
    if (!form.payment_type) return 'Pick a payment type.'
    if (!form.faucet_finish) return 'Pick a faucet finish.'
    if (!form.ro_type) return 'Pick an RO type.'
  }

  const price = Number(form.sale_price)
  if (!Number.isFinite(price) || price < 0) return 'Sale price must be zero or greater.'

  // A new job always records a term. It starts filled, so a blank here is
  // somebody clearing it, and zero is how to say no deposit.
  if (String(form.deposit_amount).trim() === '') {
    return 'Enter the deposit, or 0 if this sale takes no deposit.'
  }
  const deposit = Number(form.deposit_amount)
  if (!Number.isFinite(deposit) || deposit < 0) return 'The deposit must be zero or more.'
  if (deposit > price) return 'The deposit is more than the sale price.'

  if (form.payout_amount !== '') {
    const payout = Number(form.payout_amount)
    if (!Number.isFinite(payout) || payout < 0) return 'Installer pay must be zero or greater.'
  }

  if (form.installer_id && form.helper_id && form.installer_id === form.helper_id) {
    return 'The installer and the helper cannot be the same person.'
  }

  if (form.status === 'quoted' && (form.scheduled_date || form.install_date)) {
    return 'A quote has no scheduled or install date. Clear the date, or mark it sold.'
  }

  if (!form.scheduled_date && form.time_window) {
    return 'Pick a scheduled date before picking a time window, or clear the window.'
  }

  if (form.status === 'installed' && !selectedTemplate) {
    return 'That build sheet is no longer available, so parts cannot be deducted. Reload and pick another.'
  }

  return ''
}
