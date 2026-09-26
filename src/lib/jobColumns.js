// The columns a page needs to list jobs and open one in the drawer.
//
// Shared because the Jobs page and the Quotes page both show a list and both
// open JobDetailModal, which reads far more of the row than either list does.
// One list, so a column added for the drawer reaches both pages and neither
// quietly renders a blank panel.
export const JOB_MARGIN_COLUMNS =
  'id, created_at, customer_name, city, system_template, template_id, status, install_date, '
  + 'installer, invoice_number, faucet_finish, parts_deducted_at, parts_deduct_batch, '
  + 'sale_price, installer_pay, parts_cost, parts_count, margin, margin_pct, '
  + 'address, phone, scheduled_date, time_window, installer_id, installer_name, '
  + 'helper_id, helper_name, customer_email, agreement_status, agreement_signed_url, '
  + 'agreement_id, agreement_sent_at, agreement_completed_at, agreement_audit_log_url, '
  + 'agreement_last_error, agreement_send_count, ro_type, '
  + 'work_order_id, work_order_status, work_order_sent_at, work_order_completed_at, '
  + 'work_order_signed_url, work_order_audit_log_url, work_order_last_error, '
  + 'work_order_send_count, installer_email, site_conditions, '
  + 'agreement_view_count, work_order_view_count, nag_snoozed_until, '
  + 'deposits_taken, deposit_count, last_deposit_on, balance_due, template_line_count, '
  + 'collected_by, valve_type, payment_type, water_source, notes, payout_amount, has_job_parts, '
  + 'expected_parts_cost, parts_cost_effective, parts_cost_basis, unresolved_lines, '
  + 'deposit_amount, deposit_outstanding, is_test, sold_at, quote_sent_at, quote_sent_count, '
  // Why a profit figure is or is not shown, and which of the two blanks is
  // behind it. installer_pay is null when no payout is recorded, so the pay
  // cell needs pay_known to tell that apart from a payout of nothing.
  + 'pay_known, uncosted_parts_lines, profit_basis'
