-- ---------------------------------------------------------------------------
-- Neil Toomey and John Augustin were installed, and Water Base still said
-- scheduled.
--
-- Both installs are on signed work orders, both signed by Jay Woodward:
--
--   Neil Toomey     10918971   9/8/26, 12 to 2pm   agreed pay $1,600
--   John Augustin   10918985   9/9/26, 8 to 10am   agreed pay $800
--
-- Each goes through mark_job_installed, the one sanctioned way to install, so
-- the parts deduct from the build sheet the same way any install does and the
-- reservations are released by the trigger.
--
-- The crew is set first, as an installer_id rather than as text. Marking
-- installed only takes an installer name, which would leave installer_id on
-- ZZ Test Installer for Neil while the text said Jay. Setting the id lets the
-- roster trigger write the name.
--
-- The payout goes in with the install, because an installed job's crew and pay
-- are a record the app no longer edits.
--
-- The faucet finish stays Chrome on both, so chrome is what deducts. Neither
-- is confirmed, and each job's note says so.
--
-- Prudhvi Yalavarthi is held: his parts list is his first install, and what is
-- in his house now is not settled.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.install_from_work_order(
  p_job_id      uuid,
  p_customer    text,
  p_install     date,
  p_payout      numeric,
  p_note        text
)
returns void
language plpgsql
as $install$
declare
  v_jay      uuid;
  v_rows     int;
  v_result   json;
  v_expected int;
  v_bad      text;
begin
  select id into v_jay
  from public.installers
  where lower(btrim(email)) = 'jay.awoodward@gmail.com';

  if v_jay is null then
    raise exception 'Jay Woodward is not on the installer roster, so % cannot be installed under him.', p_customer;
  end if;

  -- what the job should consume, taken before the install so the ledger can be
  -- checked against it afterward
  create temp table if not exists expected_deduction (item_id uuid, quantity int)
    on commit drop;
  delete from expected_deduction;

  insert into expected_deduction (item_id, quantity)
  select r.item_id, sum(r.quantity)::int
  from public.resolve_job_parts(p_job_id) r
  where r.resolved
  group by r.item_id;

  select count(*) into v_expected from expected_deduction;

  if v_expected = 0 then
    raise exception '% has no parts to deduct, so marking it installed would record an install that consumed nothing.', p_customer;
  end if;

  update public.jobs
  set installer_id = v_jay
  where id = p_job_id
    and status = 'scheduled'
    and parts_deducted_at is null;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception '% is not a scheduled job with nothing deducted, so it was not installed. Setting the crew touched % rows.',
      p_customer, v_rows;
  end if;

  v_result := public.mark_job_installed(p_job_id, p_install, null, p_payout);

  if (v_result ->> 'lines_deducted')::int is distinct from v_expected then
    raise exception '% deducted % lines, expected %.', p_customer, v_result ->> 'lines_deducted', v_expected;
  end if;

  -- every expected part left the shelf in exactly the expected quantity
  select string_agg(format('%s expected %s got %s', e.item_id, e.quantity, coalesce(-t.quantity, 0)), '; ')
    into v_bad
  from expected_deduction e
  left join public.inventory_transactions t
    on t.item_id = e.item_id
   and t.job_id = p_job_id
   and t.txn_type = 'install'
  where coalesce(-t.quantity, 0) <> e.quantity;

  if v_bad is not null then
    raise exception 'The deduction for % does not match its parts list: %.', p_customer, v_bad;
  end if;

  update public.jobs
  set notes = btrim(coalesce(notes, '') || ' ' || p_note)
  where id = p_job_id
    and status = 'installed'
    and installer_id = v_jay
    and payout_amount = p_payout
    and install_date = p_install;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception '% did not land installed under Jay Woodward on % with a $% payout.', p_customer, p_install, p_payout;
  end if;
end;
$install$;

select pg_temp.install_from_work_order(
  '05683c8c-bd82-4832-af77-65af3c4cce95', 'Neil Toomey', '2026-09-08', 1600.00,
  'Installed 2026-09-08 by Jay Woodward per signed work order 10918971, payout $1,600, '
  || 'marked installed 2026-09-16. Faucet finish is unconfirmed: the work order says the '
  || 'customer asked for stainless steel and Jay brought both silver finishes. Chrome was '
  || 'deducted. Check the finish against the install photos and correct it if it was nickel.');

select pg_temp.install_from_work_order(
  'a0907e7f-cfe0-4473-84af-9fa0a9ddb6fe', 'John Augustin', '2026-09-09', 800.00,
  'Installed 2026-09-09 by Jay Woodward per signed work order 10918985, payout $800, '
  || 'marked installed 2026-09-16. Faucet finish is unconfirmed: the work order says the '
  || 'color was TBD. Chrome was deducted. Check the finish against the install photos and '
  || 'correct it if it was nickel.');
