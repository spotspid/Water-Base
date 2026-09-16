-- ---------------------------------------------------------------------------
-- The system at Steve Burgess's own house is an expense, not a job.
--
-- 20260916070000 recorded it as an installed job selling for $0. That put a
-- job with no revenue and $1,117.51 of cost into August, which reads as a sale
-- that lost money. It was the company fitting a system to its owner's house.
-- The cost is real, and so is the stock that left the shelf; only the shape
-- was wrong.
--
-- The ledger is append only, so nothing is edited or deleted. In order:
--
--   1  revert_job_install returns the three parts against the job, the one
--      sanctioned way out of installed, so the job carries no parts cost
--   2  the same three parts leave the shelf again as adjustments with no job,
--      at the same unit costs, so the shelf ends exactly where it was
--   3  the job is cancelled, so it drops out of job counts, margins and the
--      P&L's job lines. Its signed work order stays linked to it as the record
--   4  two expenses dated Aug 25 carry the cost: $500 to Jay Woodward and
--      $617.51 of parts from stock
--
-- The shelf after this is the shelf before it: RO-TL-ALK800 1, CARB-ONLY-1054
-- 0, FCT-NICKEL 5. Checked below, and the migration stops if not.
-- ---------------------------------------------------------------------------
do $expense$
declare
  v_job     uuid;
  v_status  text;
  v_batch   int;
  v_result  json;
  v_rows    int;
  v_before  jsonb;
  v_after   jsonb;
  v_cost    numeric;
  v_left    numeric;
begin
  select id, status, parts_deduct_batch into v_job, v_status, v_batch
  from public.jobs
  where address ilike '9598 Mercedes%' and sale_price = 0
  for update;

  if v_job is null then
    raise exception 'The job at 9598 Mercedes Ave is not there. Stopping.';
  end if;

  if v_status <> 'installed' then
    raise exception 'The job at 9598 Mercedes Ave is %, not installed. It may already have been moved. Stopping.', v_status;
  end if;

  if exists (select 1 from public.expenses where description ilike '%9598 Mercedes%') then
    raise exception 'An expense for 9598 Mercedes Ave already exists. Stopping rather than record it twice.';
  end if;

  -- what the install consumed, which is what the adjustments must take again
  create temp table owner_parts on commit drop as
  select t.item_id, -t.quantity as quantity, t.unit_cost_at_txn as unit_cost
  from public.inventory_transactions t
  where t.job_id = v_job and t.txn_type = 'install' and t.deduct_batch = v_batch;

  select count(*), coalesce(sum(quantity * unit_cost), 0) into v_rows, v_cost from owner_parts;

  if v_rows <> 3 or v_cost <> 617.51 then
    raise exception 'The install at 9598 Mercedes Ave shows % part lines costing %, not 3 costing 617.51. Stopping.', v_rows, v_cost;
  end if;

  select jsonb_object_agg(i.sku, (select coalesce(sum(t.quantity), 0) from public.inventory_transactions t where t.item_id = i.id))
    into v_before
  from public.inventory_items i
  where i.id in (select item_id from owner_parts);

  -- 1  out of installed, the sanctioned way
  v_result := public.revert_job_install(v_job, 'sold');

  if (v_result ->> 'lines_reversed')::int is distinct from 3 then
    raise exception 'Reversing the install returned % lines, expected 3.', v_result ->> 'lines_reversed';
  end if;

  -- 2  the parts leave the shelf again, with no job
  insert into public.inventory_transactions
    (item_id, quantity, txn_type, job_id, unit_cost_at_txn, location, reference, note, source)
  select item_id, -quantity, 'adjustment', null, unit_cost, 'Unit 4030', 'WO 004',
    'Installed Aug 25 at 9598 Mercedes Ave, the owner''s own house, by Jay Woodward (work order '
    || '10445420). Company use, not a sale: the cost is recorded as an expense dated Aug 25 rather '
    || 'than against a job.',
    'manual'
  from owner_parts;

  get diagnostics v_rows = row_count;

  if v_rows <> 3 then
    raise exception 'Taking the parts back off the shelf wrote % rows, expected 3.', v_rows;
  end if;

  select jsonb_object_agg(i.sku, (select coalesce(sum(t.quantity), 0) from public.inventory_transactions t where t.item_id = i.id))
    into v_after
  from public.inventory_items i
  where i.id in (select item_id from owner_parts);

  if v_after is distinct from v_before then
    raise exception 'The shelf moved: before %, after %. Stopping.', v_before, v_after;
  end if;

  select coalesce(sum(-quantity * coalesce(unit_cost_at_txn, 0)), 0) into v_left
  from public.inventory_transactions where job_id = v_job;

  if v_left <> 0 then
    raise exception 'The job still carries % of parts cost after the reversal. Stopping.', v_left;
  end if;

  -- 3  cancel the job, keeping it and its work order as the record
  update public.jobs
  set status = 'cancelled',
      payout_amount = null,
      notes = btrim(coalesce(notes, '') || ' Cancelled 2026-09-16 and moved to expenses: this was '
        || 'a system fitted to the owner''s own house, not a sale. The install was reversed and the '
        || 'three parts taken off the shelf again as adjustments with no job, so stock is unchanged. '
        || 'The cost is two expenses dated Aug 25: $500 to Jay Woodward and $617.51 of parts.')
  where id = v_job
    and status = 'sold'
    and parts_deducted_at is null;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Cancelling the job at 9598 Mercedes Ave touched % rows, expected 1.', v_rows;
  end if;

  -- 4  the cost, as expenses
  insert into public.expenses (spent_on, amount, vendor, category, description, source)
  values
    ('2026-08-25', 500.00, 'Jay Woodward', 'Other',
     'Installer pay for the system fitted at the owner''s house, 9598 Mercedes Ave, Redford '
     || 'Township, Aug 25. Signed work order 10445420 (job 004). Company use, not a sale.',
     'manual'),
    ('2026-08-25', 617.51, 'Stock', 'Other',
     'Parts from stock for the system fitted at the owner''s house, 9598 Mercedes Ave, Aug 25: '
     || 'Alkapro 800 tankless RO $272.76, carbon only tank $323.20, nickel RO faucet $21.55. '
     || 'Taken off the shelf as adjustments referenced WO 004.',
     'manual');

  get diagnostics v_rows = row_count;

  if v_rows <> 2 then
    raise exception 'Recording the expenses wrote % rows, expected 2.', v_rows;
  end if;
end;
$expense$;
