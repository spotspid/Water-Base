-- A test job is a real row the app has to be able to show, and nothing else
-- should count it: no dashboard figure, no reminder, no reconcile. Guessing
-- from the name ("ZZ Test") is what attention.js does to catch unmarked ones;
-- this is the mark itself.

alter table public.jobs
  add column if not exists is_test boolean not null default false;

comment on column public.jobs.is_test is
  'True for audit and test jobs. Excluded from dashboard figures, reminders and the GHL reconcile.';

update public.jobs
   set is_test = true
 where id = '6fec7536-587b-4cd8-ab35-7d1a2ad83e79'; -- ZZ Test - Steve Burgess

-- job_margin is the definition live today with is_test added as the last
-- column, so pnl_monthly and outstanding_balances, which sit on it, keep working.
create or replace view public.job_margin
with (security_invoker = true)
as
 WITH parts AS (
         SELECT j_1.id AS job_id,
            r.total,
            r.lines,
            r.unresolved
           FROM jobs j_1
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(x.line_cost) FILTER (WHERE x.resolved), 0::numeric)::numeric(10,2) AS total,
                    count(*)::integer AS lines,
                    count(*) FILTER (WHERE NOT x.resolved)::integer AS unresolved
                   FROM resolve_job_parts(j_1.id) x(line_id, line_type, pick_source, pick_category, quantity, item_id, sku, item_name, item_variant, unit_cost, line_cost, resolved, sort_order, source)) r ON true
        )
 SELECT j.id,
    j.created_at,
    j.customer_name,
    j.city,
    j.system_template,
    j.template_id,
    j.status,
    j.install_date,
    j.installer,
    j.invoice_number,
    j.faucet_finish,
    j.parts_deducted_at,
    j.parts_deduct_batch,
    j.sale_price,
    COALESCE(j.payout_amount, 0::numeric)::numeric(10,2) AS installer_pay,
    COALESCE(p.parts_cost, 0::numeric)::numeric(10,2) AS parts_cost,
    COALESCE(p.parts_count, 0::bigint)::integer AS parts_count,
        CASE
            WHEN j.parts_deducted_at IS NULL AND COALESCE(pt.lines, 0) > 0 THEN pt.total
            ELSE NULL::numeric
        END AS expected_parts_cost,
    COALESCE(pt.unresolved, 0) AS unresolved_lines,
        CASE
            WHEN j.parts_deducted_at IS NOT NULL THEN 'actual'::text
            WHEN COALESCE(pt.lines, 0) = 0 THEN 'none'::text
            WHEN COALESCE(pt.unresolved, 0) > 0 THEN 'partial'::text
            ELSE 'expected'::text
        END AS parts_cost_basis,
        CASE
            WHEN j.parts_deducted_at IS NOT NULL THEN COALESCE(p.parts_cost, 0::numeric)::numeric(10,2)
            WHEN COALESCE(pt.lines, 0) = 0 THEN NULL::numeric
            ELSE pt.total
        END AS parts_cost_effective,
        CASE
            WHEN j.parts_deducted_at IS NOT NULL THEN (j.sale_price - COALESCE(p.parts_cost, 0::numeric) - COALESCE(j.payout_amount, 0::numeric))::numeric(10,2)
            WHEN COALESCE(pt.lines, 0) = 0 OR COALESCE(pt.unresolved, 0) > 0 THEN NULL::numeric
            ELSE (j.sale_price - pt.total - COALESCE(j.payout_amount, 0::numeric))::numeric(10,2)
        END AS margin,
        CASE
            WHEN j.sale_price IS NULL OR j.sale_price = 0::numeric THEN NULL::numeric
            WHEN j.parts_deducted_at IS NOT NULL THEN round((j.sale_price - COALESCE(p.parts_cost, 0::numeric) - COALESCE(j.payout_amount, 0::numeric)) * 100.0 / j.sale_price, 1)
            WHEN COALESCE(pt.lines, 0) = 0 OR COALESCE(pt.unresolved, 0) > 0 THEN NULL::numeric
            ELSE round((j.sale_price - pt.total - COALESCE(j.payout_amount, 0::numeric)) * 100.0 / j.sale_price, 1)
        END AS margin_pct,
    j.address,
    j.phone,
    j.scheduled_date,
    j.time_window,
    j.installer_id,
    ins.name AS installer_name,
    j.helper_id,
    hlp.name AS helper_name,
    j.customer_email,
    j.agreement_status,
    j.agreement_signed_url,
    ag.id AS agreement_id,
    ag.sent_at AS agreement_sent_at,
    ag.completed_at AS agreement_completed_at,
    ag.audit_log_url AS agreement_audit_log_url,
    ag.last_error AS agreement_last_error,
    ag.send_count AS agreement_send_count,
    j.ro_type,
    wo.id AS work_order_id,
    wo.status AS work_order_status,
    wo.sent_at AS work_order_sent_at,
    wo.completed_at AS work_order_completed_at,
    wo.signed_document_url AS work_order_signed_url,
    wo.audit_log_url AS work_order_audit_log_url,
    wo.last_error AS work_order_last_error,
    wo.send_count AS work_order_send_count,
    ins.email AS installer_email,
    j.site_conditions,
    COALESCE(ag.view_count, 0) AS agreement_view_count,
    COALESCE(wo.view_count, 0) AS work_order_view_count,
    j.nag_snoozed_until,
    COALESCE(d.deposits_taken, 0::numeric)::numeric(10,2) AS deposits_taken,
    COALESCE(d.deposit_count, 0::bigint)::integer AS deposit_count,
    d.last_deposit_on,
    (COALESCE(j.sale_price, 0::numeric) - COALESCE(d.deposits_taken, 0::numeric))::numeric(10,2) AS balance_due,
    COALESCE(jp.line_count, bs.line_count, 0::bigint)::integer AS template_line_count,
    j.collected_by,
    j.valve_type,
    j.payment_type,
    j.water_source,
    j.notes,
    j.payout_amount,
    jp.line_count IS NOT NULL AS has_job_parts,
    j.deposit_amount,
        CASE
            WHEN j.deposit_amount IS NULL THEN NULL::numeric
            ELSE GREATEST(j.deposit_amount - COALESCE(d.deposits_taken, 0::numeric), 0::numeric)::numeric(10,2)
        END AS deposit_outstanding,
    j.is_test
   FROM jobs j
     LEFT JOIN parts pt ON pt.job_id = j.id
     LEFT JOIN installers ins ON ins.id = j.installer_id
     LEFT JOIN installers hlp ON hlp.id = j.helper_id
     LEFT JOIN agreements ag ON ag.job_id = j.id AND ag.type = 'customer_install'::text
     LEFT JOIN agreements wo ON wo.job_id = j.id AND wo.type = 'subcontractor_service'::text
     LEFT JOIN ( SELECT t.job_id,
            sum((- t.quantity)::numeric * COALESCE(t.unit_cost_at_txn, 0::numeric)) AS parts_cost,
            sum(- t.quantity) AS parts_count
           FROM inventory_transactions t
          WHERE t.job_id IS NOT NULL
          GROUP BY t.job_id) p ON p.job_id = j.id
     LEFT JOIN ( SELECT job_deposits.job_id,
            sum(job_deposits.amount) AS deposits_taken,
            count(*) AS deposit_count,
            max(job_deposits.received_on) AS last_deposit_on
           FROM job_deposits
          GROUP BY job_deposits.job_id) d ON d.job_id = j.id
     LEFT JOIN ( SELECT template_lines.template_id,
            count(*) AS line_count
           FROM template_lines
          GROUP BY template_lines.template_id) bs ON bs.template_id = j.template_id
     LEFT JOIN ( SELECT job_parts.job_id,
            count(*) AS line_count
           FROM job_parts
          GROUP BY job_parts.job_id) jp ON jp.job_id = j.id;
