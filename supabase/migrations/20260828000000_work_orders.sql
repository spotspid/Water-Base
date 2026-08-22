-- Work orders, on the DocuSeal mechanism the customer agreement already uses.
--
-- No new tables. A work order is an agreements row with type
-- subcontractor_service, which the unique (job_id, type) key already allows
-- alongside the customer agreement, and which the webhook already updates by
-- submission id without knowing or caring which type it is.
--
-- What is genuinely new is that the recipient is a member of the crew rather
-- than the customer, so the roster needs somewhere to hold their email.

-- ---------------------------------------------------------------------------
-- the roster gains an email
-- ---------------------------------------------------------------------------
alter table public.installers
  add column if not exists email text;

comment on column public.installers.email is
  'Where a work order is sent. Without it, send-agreement refuses rather than '
  'creating a submission with nowhere to go.';

-- ---------------------------------------------------------------------------
-- turn the subcontractor agreement on and point it at its template
--
-- The row has existed since the agreements migration, seeded inactive with no
-- template id, precisely so this step would be a setting rather than a schema
-- change. The field map is code, because each field has to be built from
-- somewhere, but which document it fills is not.
-- ---------------------------------------------------------------------------
update public.agreement_types
set docuseal_template_id = '5532104',
    active               = true,
    description          = 'Sent to the assigned installer once a job is scheduled. '
                           || 'Carries the resolved parts list for that job.',
    updated_at           = now()
where type = 'subcontractor_service';

-- ---------------------------------------------------------------------------
-- job_margin carries the work order alongside the customer agreement.
--
-- Appended rather than woven in, because create or replace view can add
-- columns at the end but cannot reorder the ones already there. The job detail
-- reads both statuses from one row rather than making a second round trip.
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
  ins.email              as installer_email
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
