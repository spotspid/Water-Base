-- auto deduct and reversal for job installs.
--
-- the double deduct guarantee has three independent layers:
--   1. jobs.parts_deducted_at is claimed by a conditional UPDATE inside the
--      deduct function. that statement takes a row lock, so of two concurrent
--      callers exactly one gets a row back and the other sees nothing.
--   2. a partial unique index on inventory_transactions makes a second write
--      of the same item for the same job and batch physically impossible,
--      even for a caller that skips these functions entirely.
--   3. a trigger keeps jobs.status and jobs.parts_deducted_at in lockstep, so
--      nobody can flip a job to installed with a plain UPDATE and skip the
--      ledger, or move it off installed and leave the parts consumed.

-- ---------------------------------------------------------------------------
-- resolve_template_parts: the parts list for a template with customer pick
-- lines resolved against a specific finish. usable before a job exists, which
-- is what lets the new job form preview what will be consumed.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_template_parts(
  p_template_id uuid,
  p_faucet_finish text default null
)
returns table (
  line_id       uuid,
  line_type     text,
  pick_source   text,
  pick_category text,
  quantity      int,
  item_id       uuid,
  sku           text,
  item_name     text,
  item_variant  text,
  unit_cost     numeric,
  line_cost     numeric,
  resolved      boolean,
  sort_order    int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    tl.id,
    tl.line_type,
    tl.pick_source,
    tl.pick_category,
    tl.quantity,
    coalesce(tl.item_id, pick.id),
    coalesce(fixed_item.sku, pick.sku),
    coalesce(fixed_item.name, pick.name),
    coalesce(fixed_item.variant, pick.variant),
    coalesce(fixed_item.unit_cost, pick.unit_cost),
    (tl.quantity * coalesce(fixed_item.unit_cost, pick.unit_cost, 0))::numeric(10,2),
    coalesce(tl.item_id, pick.id) is not null,
    tl.sort_order
  from public.template_lines tl
  left join public.inventory_items fixed_item on fixed_item.id = tl.item_id
  left join lateral (
    select i.id, i.sku, i.name, i.variant, i.unit_cost
    from public.inventory_items i
    where tl.line_type = 'customer_pick'
      and i.category = tl.pick_category
      and i.active
      and i.variant = case tl.pick_source when 'faucet_finish' then p_faucet_finish end
    order by i.created_at, i.id
    limit 1
  ) pick on true
  where tl.template_id = p_template_id
  order by tl.sort_order, tl.id
$$;

-- ---------------------------------------------------------------------------
-- jobs_guard_install_status: status and parts_deducted_at move together or
-- not at all. this is what stops a plain client UPDATE from marking a job
-- installed without consuming parts.
-- ---------------------------------------------------------------------------
create or replace function public.jobs_guard_install_status()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.status = 'installed' and new.parts_deducted_at is null then
    raise exception 'A job becomes installed through mark_job_installed() so its parts are deducted from inventory.'
      using errcode = 'WB007';
  end if;

  if new.status <> 'installed' and new.parts_deducted_at is not null then
    raise exception 'A job leaves installed through revert_job_install() so its parts are returned to inventory.'
      using errcode = 'WB008';
  end if;

  return new;
end;
$$;

drop trigger if exists jobs_guard_install_status on public.jobs;

create trigger jobs_guard_install_status
  before insert or update on public.jobs
  for each row execute function public.jobs_guard_install_status();

-- ---------------------------------------------------------------------------
-- mark_job_installed: claim the deduction, then write one install row per
-- distinct item on the resolved parts list, stamping unit_cost_at_txn.
-- ---------------------------------------------------------------------------
create or replace function public.mark_job_installed(
  p_job_id       uuid,
  p_install_date date    default null,
  p_installer    text    default null,
  p_payout       numeric default null
)
returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job         public.jobs%rowtype;
  v_template_id uuid;
  v_batch       int;
  v_unresolved  text;
  v_inserted    int;
  v_cost        numeric;
begin
  if p_job_id is null then
    raise exception 'No job was given to install.' using errcode = 'WB001';
  end if;

  if p_payout is not null and p_payout < 0 then
    raise exception 'Installer pay cannot be negative.' using errcode = 'WB009';
  end if;

  -- claim the deduction and lock the row in one statement. a second caller
  -- waits here, then finds parts_deducted_at already set and gets no row.
  update public.jobs
  set status             = 'installed',
      install_date       = coalesce(p_install_date, install_date, current_date),
      installer          = coalesce(nullif(btrim(p_installer), ''), installer),
      payout_amount      = coalesce(p_payout, payout_amount),
      parts_deducted_at  = now(),
      parts_deduct_batch = parts_deduct_batch + 1
  where id = p_job_id
    and parts_deducted_at is null
  returning * into v_job;

  if not found then
    select * into v_job from public.jobs where id = p_job_id;

    if not found then
      raise exception 'That job no longer exists. Reload the jobs list.' using errcode = 'WB001';
    end if;

    raise exception 'This job was already installed on % and its parts were already deducted. Reverse the install first if you need to redo it.',
      to_char(v_job.parts_deducted_at, 'Mon FMDD, YYYY at FMHH12:MI AM')
      using errcode = 'WB002';
  end if;

  v_batch := v_job.parts_deduct_batch;

  v_template_id := coalesce(
    v_job.template_id,
    (select t.id from public.system_templates t where t.label = v_job.system_template)
  );

  if v_template_id is null then
    raise exception 'No system template named "%" exists, so this job has no parts list. Create the template first.',
      v_job.system_template
      using errcode = 'WB003';
  end if;

  -- keep the link when the job predates template_id and matched by label
  if v_job.template_id is distinct from v_template_id then
    update public.jobs set template_id = v_template_id where id = p_job_id;
  end if;

  -- a partial deduction is worse than none, so refuse the whole thing
  select string_agg(
           format('%s line for %s', r.line_type, coalesce(r.pick_category, 'unknown category')),
           ', ')
    into v_unresolved
  from public.resolve_template_parts(v_template_id, v_job.faucet_finish) r
  where not r.resolved;

  if v_unresolved is not null then
    raise exception 'Nothing was deducted. These template lines have no matching inventory item for finish "%": %.',
      coalesce(nullif(btrim(v_job.faucet_finish), ''), 'none selected'), v_unresolved
      using errcode = 'WB004';
  end if;

  -- one row per distinct item. a template that lists the same item twice is
  -- summed rather than written twice, which keeps the unique index happy.
  insert into public.inventory_transactions
    (item_id, quantity, txn_type, job_id, unit_cost_at_txn, reference, note, source, deduct_batch)
  select
    r.item_id,
    (-sum(r.quantity))::int,
    'install',
    p_job_id,
    max(r.unit_cost),
    v_job.invoice_number,
    format('Auto deduct from template %s', v_job.system_template),
    'template',
    v_batch
  from public.resolve_template_parts(v_template_id, v_job.faucet_finish) r
  group by r.item_id;

  get diagnostics v_inserted = row_count;

  select coalesce(sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)), 0)
    into v_cost
  from public.inventory_transactions t
  where t.job_id = p_job_id;

  return json_build_object(
    'job_id',         p_job_id,
    'batch',          v_batch,
    'lines_deducted', v_inserted,
    'parts_cost',     v_cost,
    'template',       v_job.system_template
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- revert_job_install: release the claim and write one mirror row per install
-- row of the batch being reversed. history is added to, never deleted.
-- ---------------------------------------------------------------------------
create or replace function public.revert_job_install(
  p_job_id     uuid,
  p_new_status text default 'scheduled'
)
returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job      public.jobs%rowtype;
  v_batch    int;
  v_reversed int;
begin
  if p_job_id is null then
    raise exception 'No job was given to reverse.' using errcode = 'WB001';
  end if;

  if p_new_status is null or p_new_status not in ('sold', 'scheduled') then
    raise exception 'Reversing an install must land on sold or scheduled, not "%".', coalesce(p_new_status, 'null')
      using errcode = 'WB005';
  end if;

  update public.jobs
  set status            = p_new_status,
      parts_deducted_at = null
  where id = p_job_id
    and parts_deducted_at is not null
  returning * into v_job;

  if not found then
    select * into v_job from public.jobs where id = p_job_id;

    if not found then
      raise exception 'That job no longer exists. Reload the jobs list.' using errcode = 'WB001';
    end if;

    raise exception 'This job has no deducted parts to reverse.' using errcode = 'WB006';
  end if;

  v_batch := v_job.parts_deduct_batch;

  insert into public.inventory_transactions
    (item_id, quantity, txn_type, job_id, unit_cost_at_txn, reference, note, source, deduct_batch)
  select
    t.item_id,
    -t.quantity,
    'return',
    t.job_id,
    t.unit_cost_at_txn,
    t.reference,
    format('Reversal of auto deduct batch %s', v_batch),
    'template_reversal',
    v_batch
  from public.inventory_transactions t
  where t.job_id     = p_job_id
    and t.source     = 'template'
    and t.deduct_batch = v_batch;

  get diagnostics v_reversed = row_count;

  return json_build_object(
    'job_id',        p_job_id,
    'batch',         v_batch,
    'lines_reversed', v_reversed,
    'new_status',    p_new_status
  );
end;
$$;

grant execute on function public.resolve_template_parts(uuid, text) to authenticated;
grant execute on function public.mark_job_installed(uuid, date, text, numeric) to authenticated;
grant execute on function public.revert_job_install(uuid, text) to authenticated;

notify pgrst, 'reload schema';
