-- Site conditions on a job, and onto the work order.
--
-- Everything else on a work order is derived: the customer comes from the job,
-- the parts from the build sheet, the crew from the roster. Site conditions is
-- the one field with nothing behind it, so it gets a column of its own rather
-- than a placeholder on the document.
--
-- It is not notes. Notes are for the office and can say anything. This is the
-- one thing the installer needs to know about the house before he drives out,
-- and it is the only free text that leaves the building on a signed document.

alter table public.jobs
  add column if not exists site_conditions text;

comment on column public.jobs.site_conditions is
  'What the installer needs to know about the house before arriving: access, '
  'the shutoff, stairs, a dog, a tenant. Printed on the work order. Null means '
  'nothing worth saying, and the box on the document is left blank.';

-- ---------------------------------------------------------------------------
-- job_margin carries it, so the job record and the edge function both read it
-- off the same row they already fetch.
--
-- Appended at the end, because create or replace view can add columns but
-- cannot reorder the ones already there.
-- ---------------------------------------------------------------------------
create or replace view public.job_margin
with (security_invoker = true) as
select
  j.id,
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
  coalesce(j.payout_amount, 0)::numeric(10,2) as installer_pay,
  coalesce(p.parts_cost, 0)::numeric(10,2)    as parts_cost,
  coalesce(p.parts_count, 0)::int             as parts_count,
  (j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0))::numeric(10,2) as margin,
  case
    when j.sale_price is null or j.sale_price = 0 then null
    else round(
      (j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0)) * 100.0 / j.sale_price,
      1)
  end as margin_pct,
  j.address,
  j.phone,
  j.scheduled_date,
  j.time_window,
  j.installer_id,
  ins.name  as installer_name,
  j.helper_id,
  hlp.name  as helper_name,
  j.customer_email,
  j.agreement_status,
  j.agreement_signed_url,
  ag.id            as agreement_id,
  ag.sent_at       as agreement_sent_at,
  ag.completed_at  as agreement_completed_at,
  ag.audit_log_url as agreement_audit_log_url,
  ag.last_error    as agreement_last_error,
  ag.send_count    as agreement_send_count,
  j.ro_type,
  -- the work order, same shape as the customer agreement above
  wo.id                  as work_order_id,
  wo.status              as work_order_status,
  wo.sent_at             as work_order_sent_at,
  wo.completed_at        as work_order_completed_at,
  wo.signed_document_url as work_order_signed_url,
  wo.audit_log_url       as work_order_audit_log_url,
  wo.last_error          as work_order_last_error,
  wo.send_count          as work_order_send_count,
  ins.email              as installer_email,
  j.site_conditions
from public.jobs j
left join public.installers ins on ins.id = j.installer_id
left join public.installers hlp on hlp.id = j.helper_id
left join public.agreements ag
  on ag.job_id = j.id and ag.type = 'customer_install'
left join public.agreements wo
  on wo.job_id = j.id and wo.type = 'subcontractor_service'
left join (
  select
    t.job_id,
    sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)) as parts_cost,
    sum(-t.quantity)                                   as parts_count
  from public.inventory_transactions t
  where t.job_id is not null
  group by t.job_id
) p on p.job_id = j.id;

notify pgrst, 'reload schema';
