-- ---------------------------------------------------------------------------
-- Prudhvi Yalavarthi was installed twice, under one contract that changed.
--
--   Sep 3    Jay Woodward installed a salt free conditioner, a carbon only tank
--            and a tank RO. Work order 10826754, $755.
--   Sep 9    Signed change order 11017160 replaced the salt free conditioner
--            and carbon tank with a mixed bed, for $1,250 more. The contract
--            is now $3,949.
--   Sep 13   Jay Woodward removed the two tanks, installed the mixed bed and
--            finished the RO. Work order 11063635, $600.
--
-- So the job sold for $3,949, paid $1,355 in labor, and consumed every part
-- it already lists plus one MB-1054.
--
-- The removed salt free conditioner and carbon tank became MWP property under
-- the change order and were given to a family friend of the business. They
-- left inventory on the first install and never came back. That is recorded as
-- what it is:
--
--   * the install deduction takes them off the shelf and charges them to this
--     job, which is where their cost belongs: they were bought for this sale
--     and nothing was recovered for them
--   * no return is logged, because a return would put them back on the shelf,
--     and they never went back on the shelf
--   * their parts lines, the job notes and the change order record say where
--     they went, so they do not simply vanish from the record
--
-- Parts, price, crew and pay are all set before the install, because an
-- installed job's parts list is locked by job_parts_guard and its crew and pay
-- are a record the app no longer edits.
-- ---------------------------------------------------------------------------
do $prudhvi$
declare
  v_job       constant uuid := '27099a05-49e3-4110-b920-fe57fd782fcd';
  v_saltfree  uuid;
  v_carbon    uuid;
  v_mixed_bed uuid;
  v_jay       uuid;
  v_status    text;
  v_deducted  timestamptz;
  v_price     numeric;
  v_payout    numeric;
  v_rows      int;
  v_expected  int;
  v_result    json;
  v_bad       text;
  v_cost      numeric;
begin
  -- -------------------------------------------------------------------------
  -- the state this was written against
  -- -------------------------------------------------------------------------
  select status, parts_deducted_at, sale_price, payout_amount
    into v_status, v_deducted, v_price, v_payout
  from public.jobs
  where id = v_job
  for update;

  if not found then
    raise exception 'Prudhvi Yalavarthi''s job % is not there.', v_job;
  end if;

  if v_status <> 'scheduled' or v_deducted is not null then
    raise exception 'Prudhvi Yalavarthi''s job is % with parts deducted at %, not a scheduled job with nothing deducted. Stopping.',
      v_status, coalesce(v_deducted::text, 'never');
  end if;

  if v_price <> 2699.00 or v_payout is not null then
    raise exception 'Prudhvi Yalavarthi''s job reads sale price % and payout %, not the $2,699 and blank this corrects. It has changed since; stopping rather than overwrite it.',
      v_price, coalesce(v_payout::text, 'blank');
  end if;

  select id into v_saltfree  from public.inventory_items where sku = 'SALTFREE-1054';
  select id into v_carbon    from public.inventory_items where sku = 'CARB-ONLY-1054';
  select id into v_mixed_bed from public.inventory_items where sku = 'MB-1054';

  if v_saltfree is null or v_carbon is null or v_mixed_bed is null then
    raise exception 'One of SALTFREE-1054, CARB-ONLY-1054 or MB-1054 is missing from the catalogue.';
  end if;

  select id into v_jay from public.installers where lower(btrim(email)) = 'jay.awoodward@gmail.com';

  if v_jay is null then
    raise exception 'Jay Woodward is not on the installer roster.';
  end if;

  if exists (select 1 from public.job_parts where job_id = v_job and item_id = v_mixed_bed) then
    raise exception 'Prudhvi Yalavarthi''s job already lists a mixed bed. Stopping rather than add a second.';
  end if;

  -- -------------------------------------------------------------------------
  -- the parts list: where the removed tanks went, and the mixed bed
  -- -------------------------------------------------------------------------
  update public.job_parts
  set note = 'Installed Sep 3. Removed Sep 13 under change order 11017160, became MWP property '
    || 'and was given to a family friend of the business. Left inventory and never returned to stock.'
  where job_id = v_job and item_id in (v_saltfree, v_carbon);

  get diagnostics v_rows = row_count;

  if v_rows <> 2 then
    raise exception 'Noting the removed tanks touched % parts lines on Prudhvi Yalavarthi''s job, expected 2.', v_rows;
  end if;

  insert into public.job_parts (job_id, item_id, quantity, note, sort_order)
  values (v_job, v_mixed_bed, 1,
    'Installed Sep 13 under change order 11017160, replacing the salt free conditioner and carbon tank.',
    70);

  -- -------------------------------------------------------------------------
  -- the contract as changed, and the crew
  -- -------------------------------------------------------------------------
  update public.jobs
  set sale_price   = 3949.00,
      installer_id = v_jay
  where id = v_job
    and status = 'scheduled'
    and parts_deducted_at is null;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Setting Prudhvi Yalavarthi''s price and crew touched % rows, expected 1.', v_rows;
  end if;

  -- -------------------------------------------------------------------------
  -- install, and check every line of the deduction against the parts list
  -- -------------------------------------------------------------------------
  create temp table expected_deduction on commit drop as
  select r.item_id, sum(r.quantity)::int as quantity
  from public.resolve_job_parts(v_job) r
  where r.resolved
  group by r.item_id;

  select count(*) into v_expected from expected_deduction;

  if v_expected <> 7 then
    raise exception 'Prudhvi Yalavarthi''s parts list resolves to % lines, expected 7.', v_expected;
  end if;

  v_result := public.mark_job_installed(v_job, '2026-09-13', null, 1355.00);

  if (v_result ->> 'lines_deducted')::int is distinct from v_expected then
    raise exception 'Prudhvi Yalavarthi''s install deducted % lines, expected %.', v_result ->> 'lines_deducted', v_expected;
  end if;

  select string_agg(format('%s expected %s got %s', e.item_id, e.quantity, coalesce(-t.quantity, 0)), '; ')
    into v_bad
  from expected_deduction e
  left join public.inventory_transactions t
    on t.item_id = e.item_id
   and t.job_id = v_job
   and t.txn_type = 'install'
  where coalesce(-t.quantity, 0) <> e.quantity;

  if v_bad is not null then
    raise exception 'Prudhvi Yalavarthi''s deduction does not match his parts list: %.', v_bad;
  end if;

  select coalesce(sum(-quantity * coalesce(unit_cost_at_txn, 0)), 0) into v_cost
  from public.inventory_transactions
  where job_id = v_job;

  if v_cost <> 2224.69 then
    raise exception 'Prudhvi Yalavarthi''s parts cost came to %, expected 2224.69. A unit cost has moved; stopping.', v_cost;
  end if;

  -- -------------------------------------------------------------------------
  -- the change order is a signed document on this job
  -- -------------------------------------------------------------------------
  insert into public.agreement_history
    (job_id, type, docuseal_submission_id, status, sent_at, completed_at, signed_by, note)
  values
    (v_job, 'customer_install', '11017160', 'completed',
     '2026-09-09T17:46:23.732Z', '2026-09-09T18:06:57.256Z', 'yalavarthi071991@gmail.com',
     'Signed change order, System Replacement v2. Replaced the salt free conditioner and carbon '
     || 'tank with a mixed bed for $1,250, taking the contract from $2,699 to $3,949. The removed '
     || 'tanks became MWP property. The price is not in the form''s fields and is recorded as '
     || 'confirmed by the business.');

  -- -------------------------------------------------------------------------
  -- the notes
  -- -------------------------------------------------------------------------
  update public.jobs
  set notes = btrim(coalesce(notes, '') || ' Marked installed 2026-09-16. Installed in two visits, both by Jay Woodward: '
    || 'Sep 3 salt free conditioner, carbon only tank and tank RO (work order 10826754, $755), and '
    || 'Sep 13 mixed bed, removal of the two tanks and finishing the RO (work order 11063635, $600). '
    || 'Payout $1,355. Change order 11017160, signed Sep 9, replaced the salt free and carbon with the '
    || 'mixed bed for $1,250, so the sale price is $3,949. The removed salt free conditioner and carbon '
    || 'tank became MWP property and were given to a family friend of the business; they stay charged '
    || 'to this job and were never returned to stock. Faucet finish is still not recorded; chrome was '
    || 'deducted.')
  where id = v_job
    and status = 'installed'
    and install_date = '2026-09-13'
    and installer_id = v_jay
    and payout_amount = 1355.00
    and sale_price = 3949.00;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Prudhvi Yalavarthi did not land installed on Sep 13 under Jay Woodward at $3,949 with a $1,355 payout.';
  end if;
end;
$prudhvi$;
