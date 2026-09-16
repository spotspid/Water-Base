-- ---------------------------------------------------------------------------
-- The install at Steve Burgess's own house, 9598 Mercedes Ave, Redford
-- Township, which consumed stock and was never recorded.
--
-- Signed work order 10445420, job 004, issued Aug 22: Jay Woodward, arrival
-- "8/25/2026 - 8am-12pm", "Nickle reverse osmosis faucet, tankless reverse
-- osmosis system, carbon only tank", agreed pay $500. No sale price: it was the
-- company's own install, so the job sells for $0 and its parts and pay show as
-- cost with nothing against them.
--
-- The job lists its three parts and goes through mark_job_installed, dated
-- Aug 25, so the deduction is the ordinary one. Two of the three need the
-- ledger squared first, or the install would leave the shelf wrong:
--
--   CARB-ONLY-1054   The only carbon only tank the ledger has ever received
--                    came in on QB-20104 on Sep 10 and went to Prudhvi
--                    Yalavarthi. The one installed here on Aug 25 predates
--                    that, so it came from stock the ledger never recorded.
--                    Deducting it without that would put the shelf at -1.
--                    A +1 adjustment records the tank that existed, and the
--                    install takes it, so the shelf stays at 0.
--
--   FCT-NICKEL       The Aug 19 adjustment took two nickel faucets off with
--                    no job. One was the swap at Walter Radu's on Aug 20. The
--                    other has never been explained, and this install used a
--                    nickel faucet five days later. It is attributed the same
--                    way as Walter's: +1 gives the unit back, the install takes
--                    it, and the shelf stays at 5. This is the likeliest
--                    reading, not a proven one; if a count finds 4 on the
--                    shelf, the faucet here was a separate unit and an
--                    adjustment of -1 settles it.
--
--   RO-TL-ALK800     Two received Jul 16, none ever deducted. The install takes
--                    one, leaving 1.
--
-- Water source is recorded as city. Redford Township is on municipal water;
-- nothing on the work order says otherwise.
-- ---------------------------------------------------------------------------
do $house$
declare
  v_jay      uuid;
  v_custom   uuid;
  v_job      uuid;
  v_nickel   uuid;
  v_carbon   uuid;
  v_tankless uuid;
  v_before   jsonb;
  v_after    jsonb;
  v_result   json;
  v_rows     int;
  v_bad      text;
begin
  if exists (select 1 from public.jobs where address ilike '9598 Mercedes%') then
    raise exception 'A job at 9598 Mercedes Ave already exists. Stopping rather than create a second.';
  end if;

  if exists (select 1 from public.agreements where docuseal_submission_id = '10445420') then
    raise exception 'Work order 10445420 is already linked to a job. Stopping.';
  end if;

  select id into v_jay from public.installers where lower(btrim(email)) = 'jay.awoodward@gmail.com';
  select id into v_custom from public.system_templates where label = 'Custom';
  select id into v_nickel from public.inventory_items where sku = 'FCT-NICKEL';
  select id into v_carbon from public.inventory_items where sku = 'CARB-ONLY-1054';
  select id into v_tankless from public.inventory_items where sku = 'RO-TL-ALK800';

  if v_jay is null or v_custom is null or v_nickel is null or v_carbon is null or v_tankless is null then
    raise exception 'Jay Woodward, the Custom sheet, FCT-NICKEL, CARB-ONLY-1054 or RO-TL-ALK800 is missing.';
  end if;

  select jsonb_object_agg(item_id::text, on_hand) into v_before
  from (
    select i.id as item_id, coalesce(sum(t.quantity), 0)::int as on_hand
    from public.inventory_items i
    left join public.inventory_transactions t on t.item_id = i.id
    where i.id in (v_nickel, v_carbon, v_tankless)
    group by i.id
  ) s;

  if (v_before ->> v_carbon::text)::int <> 0 or (v_before ->> v_nickel::text)::int <> 5
     or (v_before ->> v_tankless::text)::int <> 2 then
    raise exception 'Stock is not what this was written against (carbon 0, nickel 5, tankless 2): %.', v_before;
  end if;

  -- the second unexplained unit must still be unexplained
  if exists (
    select 1 from public.inventory_transactions
    where item_id = v_nickel and position('second unit of adjustment 11eb2b65' in coalesce(note, '')) > 0
  ) then
    raise exception 'The second nickel faucet from the Aug 19 adjustment has already been attributed. Stopping.';
  end if;

  -- -------------------------------------------------------------------------
  -- the job
  -- -------------------------------------------------------------------------
  insert into public.jobs (
    customer_name, phone, address, city, water_source, system_template, template_id,
    sale_price, faucet_finish, ro_type, status, notes
  )
  values (
    'Steve Burgess', '', '9598 Mercedes Ave', 'Redford Township', 'city', 'Custom', v_custom,
    0, 'Brushed Nickel', 'Tankless', 'sold',
    'Company install at Steve Burgess''s own house, 9598 Mercedes Ave, Redford Township MI 48239. '
    || 'No sale price and no customer agreement: this was our own. Installed Aug 25 by Jay Woodward '
    || 'per signed work order 10445420 (job 004, issued Aug 22, arrival 8am to 12pm), payout $500. '
    || 'Parts: nickel RO faucet, Alkapro 800 tankless RO and carbon only tank. The carbon tank came '
    || 'from stock the ledger never recorded, so a +1 adjustment records it before the install takes '
    || 'it. The nickel faucet is attributed to the second, unexplained unit of the Aug 19 FCT-NICKEL '
    || 'adjustment; if a count finds 4 nickel faucets rather than 5, it was a separate unit and needs '
    || 'a -1 adjustment. Phone not supplied. Water source recorded as city.'
  )
  returning id into v_job;

  insert into public.job_parts (job_id, item_id, quantity, note, sort_order)
  values
    (v_job, v_tankless, 1, 'Alkapro 800 tankless RO.', 10),
    (v_job, v_carbon, 1, 'Carbon only tank, from stock the ledger never recorded.', 20),
    (v_job, v_nickel, 1, 'Nickel RO faucet, the second unit of the Aug 19 adjustment.', 30);

  update public.jobs set installer_id = v_jay where id = v_job;

  -- -------------------------------------------------------------------------
  -- square the ledger for the two units it never tracked
  -- -------------------------------------------------------------------------
  insert into public.inventory_transactions
    (item_id, quantity, txn_type, job_id, unit_cost_at_txn, location, reference, note, source)
  values
    (v_carbon, 1, 'adjustment', null, 323.20, 'Unit 4030', 'WO 004',
     'Carbon only tank installed at 9598 Mercedes Ave on Aug 25, before any carbon only tank was '
     || 'received into the ledger. Records the unit that existed so the install can take it '
     || 'without putting the shelf below zero.', 'manual'),
    (v_nickel, 1, 'adjustment', null, 24.25, 'Unit 4030', 'WO 004',
     'Gives back the second unit of adjustment 11eb2b65 (Aug 19, left inventory during MWP-0001). '
     || 'Attributed to the nickel faucet installed at 9598 Mercedes Ave on Aug 25, which is charged '
     || 'to that job by its install.', 'manual');

  -- -------------------------------------------------------------------------
  -- install, and check the deduction line by line
  -- -------------------------------------------------------------------------
  v_result := public.mark_job_installed(v_job, '2026-08-25', null, 500.00);

  if (v_result ->> 'lines_deducted')::int is distinct from 3 then
    raise exception 'The install deducted % lines, expected 3.', v_result ->> 'lines_deducted';
  end if;

  select string_agg(i.sku, ', ') into v_bad
  from public.inventory_items i
  where i.id in (v_nickel, v_carbon, v_tankless)
    and not exists (
      select 1 from public.inventory_transactions t
      where t.job_id = v_job and t.item_id = i.id and t.txn_type = 'install' and t.quantity = -1
    );

  if v_bad is not null then
    raise exception 'The install did not deduct exactly one of: %.', v_bad;
  end if;

  select jsonb_object_agg(item_id::text, on_hand) into v_after
  from (
    select i.id as item_id, coalesce(sum(t.quantity), 0)::int as on_hand
    from public.inventory_items i
    left join public.inventory_transactions t on t.item_id = i.id
    where i.id in (v_nickel, v_carbon, v_tankless)
    group by i.id
  ) s;

  if (v_after ->> v_carbon::text)::int <> 0 or (v_after ->> v_nickel::text)::int <> 5
     or (v_after ->> v_tankless::text)::int <> 1 then
    raise exception 'Stock after the install is not carbon 0, nickel 5, tankless 1: %.', v_after;
  end if;

  if not exists (
    select 1 from public.jobs
    where id = v_job and status = 'installed' and install_date = '2026-08-25'
      and installer_id = v_jay and payout_amount = 500.00
  ) then
    raise exception 'The job did not land installed on Aug 25 under Jay Woodward with a $500 payout.';
  end if;

  -- -------------------------------------------------------------------------
  -- the signed work order
  -- -------------------------------------------------------------------------
  insert into public.agreements (
    job_id, type, docuseal_submission_id, status, sent_at, completed_at, send_count
  )
  values (
    v_job, 'subcontractor_service', '10445420', 'completed',
    '2026-08-22T21:07:04.773Z', '2026-08-22T21:09:33.567Z', 0
  );

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Linking work order 10445420 wrote % rows, expected 1.', v_rows;
  end if;
end;
$house$;
