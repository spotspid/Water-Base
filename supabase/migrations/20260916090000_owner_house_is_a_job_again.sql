-- ---------------------------------------------------------------------------
-- The system at Steve Burgess's house is a job after all.
--
-- 20260916080000 cancelled it and moved its cost into two expenses. Steve has
-- since decided it is an installed job: installed Aug 25 by Jay Woodward, sold
-- at the $1,200 he entered, with the $500 installer pay. So it goes back to
-- installed, and the expenses are reversed so the cost is not counted twice,
-- once on the job and once as overheads.
--
-- Nothing is edited or deleted. In order:
--
--   1  the three parts come back onto the shelf as +1 adjustments with no
--      job, undoing the -1 adjustments 20260916080000 logged under WO 004
--   2  mark_job_installed installs the job from its own parts list, dated
--      Aug 25 with $500 pay, so the parts leave the shelf again against the
--      job and its cost lands on the job, where Profit and loss reads it
--   3  two expenses of -$500 and -$617.51, dated Aug 25, reverse the two
--      that 20260916080000 recorded, so August's overheads net to nothing
--      for this system
--
-- The shelf ends exactly where it was: RO-TL-ALK800 1, CARB-ONLY-1054 0,
-- FCT-NICKEL 5. Checked below, and the migration stops if not.
-- ---------------------------------------------------------------------------
do $job_again$
declare
  v_job     uuid;
  v_status  text;
  v_price   numeric;
  v_deduct  timestamptz;
  v_result  json;
  v_rows    int;
  v_before  jsonb;
  v_after   jsonb;
  v_cost    numeric;
begin
  select id, status, sale_price, parts_deducted_at
    into v_job, v_status, v_price, v_deduct
  from public.jobs
  where address ilike '9598 Mercedes%'
  for update;

  if v_job is null then
    raise exception 'The job at 9598 Mercedes Ave is not there. Stopping.';
  end if;

  if v_status <> 'cancelled' or v_deduct is not null then
    raise exception 'The job at 9598 Mercedes Ave is % with parts deducted at %, not the cancelled job this restores. Stopping.',
      v_status, coalesce(v_deduct::text, 'never');
  end if;

  if v_price <> 1200.00 then
    raise exception 'The job at 9598 Mercedes Ave sells for %, not the $1,200 entered. Stopping rather than guess.', v_price;
  end if;

  if (select count(*) from public.job_parts where job_id = v_job) <> 3 then
    raise exception 'The job at 9598 Mercedes Ave does not list its three parts. Stopping.';
  end if;

  if (select count(*) from public.expenses where description ilike '%9598 Mercedes%' and amount > 0) <> 2 then
    raise exception 'The two expenses for 9598 Mercedes Ave are not both there. Stopping.';
  end if;

  if exists (select 1 from public.expenses where description ilike '%9598 Mercedes%' and amount < 0) then
    raise exception 'The expenses for 9598 Mercedes Ave have already been reversed. Stopping.';
  end if;

  -- the -1 adjustments that took the parts off with no job
  create temp table owner_parts on commit drop as
  select t.item_id, -t.quantity as quantity, t.unit_cost_at_txn as unit_cost
  from public.inventory_transactions t
  where t.reference = 'WO 004' and t.txn_type = 'adjustment' and t.job_id is null and t.quantity < 0;

  if (select count(*) from owner_parts) <> 3 then
    raise exception 'The three WO 004 adjustments that took the parts off the shelf are not all there. Stopping.';
  end if;

  select jsonb_object_agg(i.sku, (select coalesce(sum(t.quantity), 0) from public.inventory_transactions t where t.item_id = i.id))
    into v_before
  from public.inventory_items i
  where i.id in (select item_id from owner_parts);

  -- 1  back onto the shelf
  insert into public.inventory_transactions
    (item_id, quantity, txn_type, job_id, unit_cost_at_txn, location, reference, note, source)
  select item_id, quantity, 'adjustment', null, unit_cost, 'Unit 4030', 'WO 004',
    'Undoes the WO 004 adjustment that took this part off with no job. The system at 9598 Mercedes '
    || 'Ave is an installed job again, and its install takes the part against the job.',
    'manual'
  from owner_parts;

  get diagnostics v_rows = row_count;

  if v_rows <> 3 then
    raise exception 'Returning the parts wrote % rows, expected 3.', v_rows;
  end if;

  -- 2  installed again, the sanctioned way
  v_result := public.mark_job_installed(v_job, '2026-08-25', null, 500.00);

  if (v_result ->> 'lines_deducted')::int is distinct from 3 then
    raise exception 'The install deducted % lines, expected 3.', v_result ->> 'lines_deducted';
  end if;

  select coalesce(sum(-quantity * coalesce(unit_cost_at_txn, 0)), 0) into v_cost
  from public.inventory_transactions where job_id = v_job;

  if v_cost <> 617.51 then
    raise exception 'The job carries % of parts after the install, expected 617.51. Stopping.', v_cost;
  end if;

  select jsonb_object_agg(i.sku, (select coalesce(sum(t.quantity), 0) from public.inventory_transactions t where t.item_id = i.id))
    into v_after
  from public.inventory_items i
  where i.id in (select item_id from owner_parts);

  if v_after is distinct from v_before then
    raise exception 'The shelf moved: before %, after %. Stopping.', v_before, v_after;
  end if;

  if not exists (
    select 1 from public.jobs
    where id = v_job and status = 'installed' and install_date = '2026-08-25'
      and payout_amount = 500.00 and sale_price = 1200.00
  ) then
    raise exception 'The job did not land installed on Aug 25 at $1,200 with $500 pay.';
  end if;

  -- 3  reverse the two expenses
  insert into public.expenses (spent_on, amount, vendor, category, description, source)
  values
    ('2026-08-25', -500.00, 'Jay Woodward', 'Other',
     'Reverses the $500 installer pay expense for 9598 Mercedes Ave. The system is an installed job '
     || 'again and its pay is counted on the job, not as an overhead.',
     'manual'),
    ('2026-08-25', -617.51, 'Stock', 'Other',
     'Reverses the $617.51 parts expense for 9598 Mercedes Ave. The system is an installed job again '
     || 'and its parts are counted on the job, not as an overhead.',
     'manual');

  get diagnostics v_rows = row_count;

  if v_rows <> 2 then
    raise exception 'Reversing the expenses wrote % rows, expected 2.', v_rows;
  end if;

  update public.jobs
  set notes = btrim(coalesce(notes, '') || ' Restored 2026-09-16 as an installed job: installed Aug '
    || '25, sold at $1,200, $500 installer pay. The three parts were put back on the shelf and '
    || 'deducted again against this job, and the two Aug 25 expenses were reversed so the cost is '
    || 'counted once, here.')
  where id = v_job;
end;
$job_again$;
