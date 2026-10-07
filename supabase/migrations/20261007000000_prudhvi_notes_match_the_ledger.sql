-- Prudhvi's parts list still says the tanks never came back.
--
-- Two notes, written 2026-09-16, say the salt free conditioner and the carbon
-- only tank "became MWP property and was given to a family friend of the
-- business. Left inventory and never returned to stock."
--
-- That was believed at the time and is not what happened.
-- 20260927020000_prudhvi_change_order_returns put both units back on the shelf
-- as returns against this job, at the cost they were deducted at, and the
-- ledger has read that way since 2026-09-27. Both SKUs show 1 on hand today.
--
-- So the job says one thing and the ledger says the opposite, and the job is
-- what somebody reads first.
--
-- Correcting it ran into the parts guard, which is the second half of this
-- migration and the more interesting one.

-- -----------------------------------------------------------------------------
-- 1. The guard refuses a note
-- -----------------------------------------------------------------------------
--
-- job_parts_guard refuses every change to a parts line once the job's parts are
-- in the ledger. That is right for the list: quantity, item and the existence
-- of a line are what the ledger was written from, and letting them move would
-- let a job disagree with what left the shelf.
--
-- The note is not the list. It carries no quantity, no item and no cost, and
-- nothing is computed from it. Refusing it does not protect the ledger; here it
-- actively stopped the job from being made to agree with the ledger, which is
-- the opposite of the guard's purpose.
--
-- So an update that changes only the note is allowed. Everything else is
-- refused exactly as before, including on the same row in the same statement:
-- touch the quantity as well and the whole update is refused.

create or replace function public.job_parts_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job public.jobs%rowtype;
  v_id  uuid;
begin
  if tg_op = 'DELETE' then
    v_id := old.job_id;
  else
    v_id := new.job_id;
  end if;

  select * into v_job from public.jobs where id = v_id;

  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;

    raise exception 'That job no longer exists, so its parts list cannot be changed.'
      using errcode = 'WB025';
  end if;

  -- The note, and only the note. Every other column is compared, so a new one
  -- added later is refused by default rather than let through by an omission.
  if tg_op = 'UPDATE'
    and new.id         is not distinct from old.id
    and new.created_at is not distinct from old.created_at
    and new.job_id     is not distinct from old.job_id
    and new.item_id    is not distinct from old.item_id
    and new.quantity   is not distinct from old.quantity
    and new.sort_order is not distinct from old.sort_order
  then
    return new;
  end if;

  if v_job.parts_deducted_at is not null then
    raise exception
      'This job installed on % and its parts are already in the ledger, which is append only. '
      'Its parts list cannot be changed. Reverse the install first if the list was wrong, which '
      'returns the parts to inventory. The note on a line can still be corrected.',
      to_char(v_job.parts_deducted_at, 'Mon FMDD, YYYY')
      using errcode = 'WB025';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 2. The correction
-- -----------------------------------------------------------------------------
--
-- Only the note moves. The parts lines themselves are right: those units were
-- installed on Sep 3 and their cost belongs to this job, with the Sep 27 return
-- crediting it back.

do $$
declare
  v_job  uuid;
  v_rows int;
begin
  select id into v_job from public.jobs where customer_name = 'Prudhvi Yalavarthi';

  if v_job is null then
    raise exception 'Prudhvi Yalavarthi has no job to correct.';
  end if;

  update public.job_parts jp
  set note = 'Installed Sep 3. Removed Sep 13 under change order 11017160 and replaced by the '
    || 'mixed bed system. The unit became MWP property and was returned to stock on Sep 27 at '
    || 'the cost it was deducted at, so this job is credited what it was charged for it. It is '
    || 'a used unit sitting on the new SKU because there is no used one to value it on. An '
    || 'earlier version of this note said it was given away and never came back; that was wrong, '
    || 'and the ledger has been right since Sep 27.'
  from public.inventory_items i
  where jp.item_id = i.id
    and jp.job_id = v_job
    and i.sku in ('SALTFREE-1054', 'CARB-ONLY-1054');

  get diagnostics v_rows = row_count;

  if v_rows <> 2 then
    raise exception 'Correcting the removed tank notes touched % lines, expected 2.', v_rows;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Proof
-- -----------------------------------------------------------------------------

do $$
declare
  v_job     uuid;
  v_stale   int;
  v_onhand  int;
  v_returns int;
  v_qty     int;
  v_msg     text;
begin
  select id into v_job from public.jobs where customer_name = 'Prudhvi Yalavarthi';

  -- 1. nothing on this job still claims the tanks never came back
  select count(*) into v_stale
  from public.job_parts
  where job_id = v_job and note ilike '%never returned to stock%';

  if v_stale <> 0 then
    raise exception '% parts lines still say the tanks never returned.', v_stale;
  end if;

  -- 2. the ledger still shows both returns, so the new note is the true one
  select count(*) into v_returns
  from public.inventory_transactions t
  join public.inventory_items i on i.id = t.item_id
  where t.job_id = v_job and t.txn_type = 'return'
    and i.sku in ('SALTFREE-1054', 'CARB-ONLY-1054');

  if v_returns <> 2 then
    raise exception 'Expected 2 returns against this job, found %.', v_returns;
  end if;

  -- 3. both units are still on the shelf, which is what the note now says
  for v_msg, v_onhand in
    select i.sku, coalesce(sum(t.quantity), 0)::int
    from public.inventory_items i
    left join public.inventory_transactions t on t.item_id = i.id
    where i.sku in ('SALTFREE-1054', 'CARB-ONLY-1054')
    group by i.sku
  loop
    if v_onhand <> 1 then
      raise exception '% reads % on hand, expected 1.', v_msg, v_onhand;
    end if;
  end loop;

  -- 4. the quantities were not touched by the note change
  select coalesce(sum(jp.quantity), 0) into v_qty
  from public.job_parts jp
  join public.inventory_items i on i.id = jp.item_id
  where jp.job_id = v_job and i.sku in ('SALTFREE-1054', 'CARB-ONLY-1054');

  if v_qty <> 2 then
    raise exception 'The two lines total % units, expected 2.', v_qty;
  end if;

  raise notice 'the parts notes and the ledger now say the same thing';
end $$;

-- 5. and the guard still refuses a real change to an installed job's list
do $$
declare
  v_job uuid;
  v_msg text;
begin
  select id into v_job from public.jobs where customer_name = 'Prudhvi Yalavarthi';

  begin
    update public.job_parts jp
    set quantity = jp.quantity + 1
    from public.inventory_items i
    where jp.item_id = i.id and jp.job_id = v_job and i.sku = 'SALTFREE-1054';

    raise exception 'the guard allowed a quantity change on an installed job';
  exception
    when sqlstate 'WB025' then
      get stacked diagnostics v_msg = message_text;

      if v_msg not like '%append only%' then
        raise exception 'the refusal was not the append only one: %', v_msg;
      end if;

      raise notice 'a quantity change is still refused, and says why';
  end;
end $$;
