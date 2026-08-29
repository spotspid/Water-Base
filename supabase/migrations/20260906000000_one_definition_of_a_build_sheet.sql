-- One definition of a build sheet, and an empty one stops a work order.
--
-- Two halves of the system disagreed about what linked a job to its parts.
--
-- sync_job_reservations resolved the sheet by template_id and, failing that,
-- by matching system_template against the sheet's label. The work order sender
-- only ever looked at template_id. So seven back loaded jobs held reservations
-- for parts the sender then refused to print, saying the job had no build
-- sheet while the shelf had already set those parts aside for it. Both halves
-- were self consistent and the pair was not, which is the hardest kind of
-- wrong to see.
--
-- The label is a display string. It is not a key, it is editable, and two
-- sheets could carry the same one tomorrow. template_id is the link, and after
-- this it is the only one.

-- ---------------------------------------------------------------------------
-- link the jobs that were only ever labelled
-- ---------------------------------------------------------------------------
update public.jobs j
set template_id = t.id
from public.system_templates t
where j.template_id is null
  and t.label = j.system_template;

-- ---------------------------------------------------------------------------
-- and refuse to guess again
--
-- A job naming a sheet it is not linked to is now an error rather than a quiet
-- match. It fails at the moment the job is written, which is where the mistake
-- actually is, instead of surfacing weeks later as a work order that will not
-- send.
--
-- A job with no sheet at all is untouched and still legitimate: plenty of work
-- is one off. That is template_id null and a label matching nothing, and it
-- releases its reservations exactly as before.
-- ---------------------------------------------------------------------------
create or replace function public.sync_job_reservations(p_job_id uuid)
returns json
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_job         public.jobs%rowtype;
  v_template_id uuid;
  v_released    int := 0;
  v_open        int := 0;
  v_units       int := 0;
  v_unresolved  int := 0;
begin
  if p_job_id is null then
    raise exception 'No job was given to reserve parts for.' using errcode = 'WB012';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;

  if not found then
    raise exception 'That job no longer exists, so its reservations cannot be updated.'
      using errcode = 'WB012';
  end if;

  if v_job.status in ('installed', 'cancelled') or v_job.parts_deducted_at is not null then
    update public.job_reservations
    set released_at     = now(),
        released_reason = case when v_job.status = 'cancelled' then 'cancelled' else 'installed' end
    where job_id = p_job_id
      and released_at is null;

    get diagnostics v_released = row_count;

    return json_build_object(
      'job_id', p_job_id, 'template_id', null, 'open_lines', 0,
      'released_lines', v_released, 'units_committed', 0, 'unresolved_lines', 0
    );
  end if;

  -- No date, no claim.
  if v_job.scheduled_date is null then
    update public.job_reservations
    set released_at     = now(),
        released_reason = 'unscheduled'
    where job_id = p_job_id
      and released_at is null;

    get diagnostics v_released = row_count;

    return json_build_object(
      'job_id', p_job_id, 'template_id', null, 'open_lines', 0,
      'released_lines', v_released, 'units_committed', 0, 'unresolved_lines', 0
    );
  end if;

  -- Named but not linked. This used to resolve silently by label.
  if v_job.template_id is null
     and exists (select 1 from public.system_templates t where t.label = v_job.system_template)
  then
    raise exception
      'This job names the build sheet "%" but is not linked to it, so its parts '
      'would be claimed and could never be printed on a work order. Set the '
      'template on the job rather than only its name.',
      v_job.system_template
      using errcode = 'WB012';
  end if;

  v_template_id := v_job.template_id;

  if v_template_id is null then
    update public.job_reservations
    set released_at     = now(),
        released_reason = 'template_changed'
    where job_id = p_job_id
      and released_at is null;

    get diagnostics v_released = row_count;

    return json_build_object(
      'job_id', p_job_id, 'template_id', null, 'open_lines', 0,
      'released_lines', v_released, 'units_committed', 0, 'unresolved_lines', 0
    );
  end if;

  with wanted as (
    select r.item_id, sum(r.quantity)::int as quantity
    from public.resolve_template_parts(v_template_id, v_job.faucet_finish, v_job.ro_type) r
    where r.resolved and r.item_id is not null
    group by r.item_id
  ),
  released as (
    update public.job_reservations jr
    set released_at     = now(),
        released_reason = 'template_changed'
    where jr.job_id = p_job_id
      and jr.released_at is null
      and not exists (select 1 from wanted w where w.item_id = jr.item_id)
    returning 1
  ),
  upserted as (
    insert into public.job_reservations (job_id, item_id, quantity)
    select p_job_id, w.item_id, w.quantity
    from wanted w
    on conflict (job_id, item_id) where released_at is null
    do update set quantity = excluded.quantity
    returning 1
  )
  select count(*)::int into v_released from released;

  select count(*)::int, coalesce(sum(jr.quantity), 0)::int
    into v_open, v_units
  from public.job_reservations jr
  where jr.job_id = p_job_id and jr.released_at is null;

  select count(*)::int into v_unresolved
  from public.resolve_template_parts(v_template_id, v_job.faucet_finish, v_job.ro_type) r
  where not r.resolved;

  return json_build_object(
    'job_id', p_job_id, 'template_id', v_template_id, 'open_lines', v_open,
    'released_lines', v_released, 'units_committed', v_units,
    'unresolved_lines', v_unresolved
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- how many lines the job's sheet carries
--
-- The work order sender needs this before it builds anything. A sheet with no
-- lines resolves cleanly, because nothing to resolve cannot fail, so counting
-- unresolved lines never catches it. The document would go out reading "No
-- parts list on this build sheet", which is worse than a refusal: it looks
-- finished and tells the installer to bring nothing.
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
      (j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0)) * 100.0 / j.sale_price, 1)
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
  wo.id                  as work_order_id,
  wo.status              as work_order_status,
  wo.sent_at             as work_order_sent_at,
  wo.completed_at        as work_order_completed_at,
  wo.signed_document_url as work_order_signed_url,
  wo.audit_log_url       as work_order_audit_log_url,
  wo.last_error          as work_order_last_error,
  wo.send_count          as work_order_send_count,
  ins.email              as installer_email,
  j.site_conditions,
  coalesce(ag.view_count, 0)::int as agreement_view_count,
  coalesce(wo.view_count, 0)::int as work_order_view_count,
  j.nag_snoozed_until,
  coalesce(d.deposits_taken, 0)::numeric(10,2) as deposits_taken,
  coalesce(d.deposit_count, 0)::int            as deposit_count,
  d.last_deposit_on,
  (coalesce(j.sale_price, 0) - coalesce(d.deposits_taken, 0))::numeric(10,2) as balance_due,
  -- the build sheet
  coalesce(bs.line_count, 0)::int as template_line_count
from public.jobs j
left join public.installers ins on ins.id = j.installer_id
left join public.installers hlp on hlp.id = j.helper_id
left join public.agreements ag on ag.job_id = j.id and ag.type = 'customer_install'
left join public.agreements wo on wo.job_id = j.id and wo.type = 'subcontractor_service'
left join (
  select t.job_id,
         sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)) as parts_cost,
         sum(-t.quantity)                                   as parts_count
  from public.inventory_transactions t
  where t.job_id is not null
  group by t.job_id
) p on p.job_id = j.id
left join (
  select job_id, sum(amount) as deposits_taken, count(*) as deposit_count,
         max(received_on) as last_deposit_on
  from public.job_deposits
  group by job_id
) d on d.job_id = j.id
left join (
  select template_id, count(*) as line_count
  from public.template_lines
  group by template_id
) bs on bs.template_id = j.template_id;

-- ---------------------------------------------------------------------------
-- prove it, so a broken migration cannot apply quietly
-- ---------------------------------------------------------------------------
do $$
declare
  v_orphans int;
begin
  select count(*) into v_orphans
  from public.jobs j
  where j.template_id is null
    and exists (select 1 from public.system_templates t where t.label = j.system_template);

  if v_orphans <> 0 then
    raise exception '% job(s) still name a build sheet without being linked to it', v_orphans;
  end if;
end $$;

notify pgrst, 'reload schema';
