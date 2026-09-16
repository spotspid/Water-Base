-- ---------------------------------------------------------------------------
-- One of the two nickel faucets that "left inventory during MWP-0001" was the
-- faucet swap on Jay Woodward's visit to Walter Radu on Aug 20.
--
-- The Aug 19 adjustment took two FCT-NICKEL off the shelf with no job, so
-- neither unit was costed anywhere. One is now known: it went into Walter
-- Radu's house in place of the chrome faucet Anthony Thomas installed. The
-- chrome one never came back to stock, so it stays charged to the job too.
-- He is charged for both, which is what happened: one went in, one was lost.
--
-- The ledger is append only, so the adjustment is not edited. It is offset:
--
--   +1 adjustment  no job   gives back one unit of the Aug 19 adjustment
--   -1 install     Walter   the same unit, consumed on MWP-0001 at $24.25
--
-- The shelf does not move. The second unit of the adjustment stays
-- unexplained, because nothing says where it went.
--
-- The install row is written the way the back loaded MWP-0001 rows were, as
-- template source in deduct batch 1. That is what revert_job_install reads,
-- so undoing this install returns this faucet with the rest rather than
-- leaving it stranded on the job. With the job's finish set to Brushed Nickel
-- below, the build sheet's faucet line resolves to FCT-NICKEL, so the row
-- agrees with the sheet.
--
-- No valve is costed. Jay repaired the damaged valve rather than replacing it.
-- ---------------------------------------------------------------------------
do $nickel$
declare
  v_job        constant uuid := 'a8da94cd-ae94-433d-ae8e-eec2c6657a89';
  v_adjustment constant uuid := '11eb2b65-9b9b-4745-b873-336ed63da89e';
  v_marker     constant text := 'one unit of adjustment 11eb2b65';
  v_item       uuid;
  v_qty        int;
  v_batch      int;
  v_before     int;
  v_after      int;
  v_rows       int;
begin
  select t.item_id, t.quantity into v_item, v_qty
  from public.inventory_transactions t
  join public.inventory_items i on i.id = t.item_id
  where t.id = v_adjustment
    and i.sku = 'FCT-NICKEL'
    and t.txn_type = 'adjustment'
    and t.job_id is null;

  if v_item is null then
    raise exception 'The Aug 19 FCT-NICKEL adjustment % is not in the ledger as expected.', v_adjustment;
  end if;

  if v_qty <> -2 then
    raise exception 'The Aug 19 FCT-NICKEL adjustment moved % units, not the 2 this corrects.', v_qty;
  end if;

  -- run once. A second run would charge the job a second faucet.
  if exists (
    select 1 from public.inventory_transactions
    where item_id = v_item and position(v_marker in coalesce(note, '')) > 0
  ) then
    raise exception 'One unit of that adjustment has already been attributed to Walter Radu. Nothing to do.';
  end if;

  select parts_deduct_batch into v_batch
  from public.jobs
  where id = v_job and status = 'installed' and parts_deducted_at is not null
  for update;

  if v_batch is null then
    raise exception 'Walter Radu''s job is not an installed job with deducted parts, so a faucet cannot be charged to its install.';
  end if;

  select coalesce(sum(quantity), 0)::int into v_before
  from public.inventory_transactions where item_id = v_item;

  insert into public.inventory_transactions
    (item_id, quantity, txn_type, job_id, unit_cost_at_txn, location, reference, note, source, deduct_batch)
  values
    (v_item, 1, 'adjustment', null, 24.25, 'Unit 4030', 'MWP-0001',
     'Gives back ' || v_marker || ' (Aug 19, left inventory during MWP-0001). That unit was '
       || 'the nickel faucet swapped in on Jay Woodward''s Aug 20 visit and is charged to '
       || 'Walter Radu''s job in the row logged with this one.',
     'manual', null),
    (v_item, -1, 'install', v_job, 24.25, 'Unit 4030', 'MWP-0001',
     'Brushed nickel faucet swapped in for chrome on Jay Woodward''s Aug 20 follow up visit. '
       || 'Was ' || v_marker || '; the chrome faucet it replaced never returned to stock.',
     'template', v_batch);

  get diagnostics v_rows = row_count;

  if v_rows <> 2 then
    raise exception 'Logging the faucet attribution wrote % rows, expected 2.', v_rows;
  end if;

  select coalesce(sum(quantity), 0)::int into v_after
  from public.inventory_transactions where item_id = v_item;

  if v_after <> v_before then
    raise exception 'FCT-NICKEL on hand moved from % to %. The attribution must leave the shelf alone.',
      v_before, v_after;
  end if;

  -- The customer has nickel, so the job says nickel. The job is installed, so
  -- the reservations trigger only confirms nothing is held for it.
  update public.jobs
  set faucet_finish = 'Brushed Nickel',
      notes = btrim(coalesce(notes, '') || ' Faucet finish corrected to Brushed Nickel 2026-09-16: '
        || 'Jay Woodward swapped the chrome faucet for nickel on Aug 20. The nickel faucet is '
        || 'charged from one unit of the unexplained Aug 19 FCT-NICKEL adjustment, and the chrome '
        || 'one stays charged because it never returned to stock. No valve was used: Jay repaired '
        || 'the damaged valve rather than replacing it.')
  where id = v_job
    and faucet_finish = 'Chrome';

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Setting Walter Radu''s faucet finish touched % rows, expected 1. It may no longer say Chrome.', v_rows;
  end if;
end;
$nickel$;
