-- What the data says is wrong with itself.
--
-- Every fault found in this database since September was found by somebody
-- running a query by hand: a signed agreement with no job, a price that stayed
-- behind a revised agreement, a payment recorded against nothing, a parts note
-- saying the opposite of the ledger, and eight installs that happened and were
-- never marked. Thirty-one check scripts exist and every one of them checks
-- code. Nothing checked the data.
--
-- This is plain SQL on purpose. It is read, argued with and proved the same
-- way as everything else here, it costs nothing to run, and it needs nobody's
-- API key or judgement. ghl_reconcile is the model.
--
-- One row per thing that is wrong. A check that is right says nothing, so an
-- empty result is the healthy state and the caller does not have to know which
-- checks exist to know the answer.
--
-- Severity is three words rather than a number, because a number invites
-- somebody to sum it:
--   money    a figure a human reads is wrong, or work is unbilled
--   stock    the shelf disagrees with what is promised or recorded
--   process  nothing is wrong yet and something is being forgotten

create or replace function public.data_health()
returns table (
  severity   text,
  check_key  text,
  subject    text,
  detail     text,
  job_id     uuid,
  amount     numeric
)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$

  -- An install that was scheduled and never marked. The one that hid $21,842
  -- of revenue from the profit and loss for three weeks, because the page
  -- counts installed jobs and nothing chased the gap.
  select 'money', 'install_overdue',
         j.customer_name,
         format('Scheduled %s, %s days ago, and still not marked installed. '
                'Its revenue, its parts and its installer pay are all waiting on this.',
                to_char(j.scheduled_date, 'Mon FMDD'), current_date - j.scheduled_date),
         j.id, j.sale_price
  from public.jobs j
  where not coalesce(j.is_test, false)
    and j.status = 'scheduled'
    and j.scheduled_date < current_date

  union all

  -- An install that cannot be marked even if somebody tries, because a pick
  -- has no answer. Said here in the words of the fix rather than the words of
  -- the failure: the refusal itself names template lines and pick sources.
  select 'money', 'install_blocked',
         j.customer_name,
         format('Cannot be marked installed until these are chosen on the job: %s.',
                (select string_agg(distinct replace(r.pick_source, '_', ' '), ' and ')
                 from public.resolve_job_parts(j.id) r where not r.resolved)),
         j.id, j.sale_price
  from public.jobs j
  where not coalesce(j.is_test, false)
    and j.status in ('sold', 'scheduled')
    and exists (select 1 from public.resolve_job_parts(j.id) r where not r.resolved)

  union all

  -- Work that is finished or booked with nobody's pay against it. An unknown
  -- payout is not a payout of nothing, so the margin on these reads as unknown
  -- rather than wrong, which is correct and still needs answering.
  select 'money', 'no_installer_pay',
         j.customer_name,
         'Booked or installed with no installer pay recorded, so this job has no profit figure.',
         j.id, j.sale_price
  from public.jobs j
  where not coalesce(j.is_test, false)
    and j.status in ('scheduled', 'installed')
    and j.payout_amount is null

  union all

  -- Sold work with nothing collected against it, after long enough that it is
  -- not simply recent.
  select 'money', 'nothing_collected',
         j.customer_name,
         format('Sold %s and no payment is recorded against it.',
                to_char(coalesce(j.sold_at, j.created_at), 'Mon FMDD')),
         j.id, j.sale_price
  from public.jobs j
  where not coalesce(j.is_test, false)
    and j.status in ('sold', 'scheduled', 'installed')
    and coalesce(j.sold_at, j.created_at) < now() - interval '7 days'
    and not exists (select 1 from public.job_deposits d where d.job_id = j.id)

  union all

  -- A signed agreement on a job still reading quoted. The trigger moves it,
  -- so this only fires when something went round the side.
  select 'money', 'signed_not_sold',
         j.customer_name,
         'The customer agreement is signed but this job still reads quoted.',
         j.id, j.sale_price
  from public.jobs j
  where not coalesce(j.is_test, false)
    and j.status = 'quoted'
    and j.agreement_status = 'completed'

  union all

  -- Sold work with no parts behind it at all, so its margin is the whole price
  -- and its shelf impact is nothing. Donna Burgess read this way for a week.
  select 'money', 'no_parts_list',
         j.customer_name,
         'Sold with no parts list, so its cost is nothing and its margin is the whole price.',
         j.id, j.sale_price
  from public.jobs j
  where not coalesce(j.is_test, false)
    and j.status in ('sold', 'scheduled')
    and not exists (select 1 from public.resolve_job_parts(j.id) r)

  union all

  -- More promised than exists. Deliberately possible, deliberately visible.
  select 'stock', 'oversold',
         i.sku || ' ' || i.name,
         format('%s on the shelf, %s promised to booked jobs. Short %s.',
                coalesce(h.on_hand, 0), coalesce(p.promised, 0),
                coalesce(p.promised, 0) - coalesce(h.on_hand, 0)),
         null::uuid,
         (coalesce(p.promised, 0) - coalesce(h.on_hand, 0))::numeric
  from public.inventory_items i
  left join lateral (
    select sum(t.quantity) as on_hand
    from public.inventory_transactions t where t.item_id = i.id) h on true
  left join lateral (
    select sum(r.quantity) as promised
    from public.job_reservations r where r.item_id = i.id and r.released_at is null) p on true
  where i.active
    and coalesce(p.promised, 0) > coalesce(h.on_hand, 0)

  union all

  -- A supplier line nobody is waiting for any more. One Dual Tank Well Iron
  -- Breaker has been outstanding since 17 August.
  select 'stock', 'order_stuck',
         coalesce(nullif(o.order_number, ''), o.supplier) || ' ' || i.sku,
         format('%s of %s still outstanding %s days after the order date. '
                'Receive it, or record what is not coming.',
                l.quantity_ordered - l.quantity_received, l.quantity_ordered,
                current_date - o.order_date),
         null::uuid,
         (l.quantity_ordered - l.quantity_received)::numeric
  from public.supplier_order_lines l
  join public.supplier_orders o on o.id = l.order_id
  join public.inventory_items i on i.id = l.item_id
  where o.status <> 'cancelled'
    and l.quantity_received < l.quantity_ordered
    and o.order_date < current_date - 30

  union all

  -- A test row that neither rule catches. The two definitions of a test job
  -- are a known fault; this says when they disagree about a real row.
  select 'process', 'test_row_counted',
         j.customer_name,
         'Looks like a test row but is not flagged as one, so it counts as real revenue.',
         j.id, j.sale_price
  from public.jobs j
  where not coalesce(j.is_test, false)
    and (j.customer_name ~* '(^|[^a-z])(zz|test)([^a-z]|$)'
         or j.invoice_number ~* 'test')

$function$;

comment on function public.data_health() is
  'Every rule the data has to obey, one row per breach. Empty means healthy. '
  'Plain SQL on purpose: readable, provable, and needing nobody''s judgement.';

grant execute on function public.data_health() to authenticated;

notify pgrst, 'reload schema';

-- Proof. The checks have to find what is known to be wrong today, and have to
-- go quiet when it is put right.
do $$
declare
  v_rows   int;
  v_money  int;
  v_job    uuid;
  v_before int;
  v_after  int;
begin
  select count(*) into v_rows from public.data_health();

  if v_rows = 0 then
    raise exception 'The checks found nothing at all, which given this database means they are not looking.';
  end if;

  -- 1. the overdue installs are seen
  select count(*) into v_money from public.data_health() where check_key = 'install_overdue';

  if v_money < 1 then
    raise exception 'install_overdue found nothing, and there are jobs past their date.';
  end if;

  -- 2. the blocked ones name the pick rather than the plumbing
  if exists (
    select 1 from public.data_health()
    where check_key = 'install_blocked'
      and (detail ilike '%template line%' or detail ilike '%customer_pick%' or detail is null)) then
    raise exception 'install_blocked is still speaking in table names.';
  end if;

  -- 3. a check goes quiet when the thing is fixed. Proved on a scratch job so
  --    no real row is touched.
  insert into public.jobs (customer_name, phone, address, city, water_source,
                           system_template, sale_price, status, is_test)
  values ('ZZ Health Check Probe', '000', 'nowhere', 'nowhere', 'city',
          'Custom', 1000, 'scheduled', false)
  returning id into v_job;

  update public.jobs set scheduled_date = current_date - 5 where id = v_job;

  select count(*) into v_before from public.data_health()
  where job_id = v_job and check_key = 'install_overdue';

  if v_before <> 1 then
    raise exception 'A job five days past its date was not reported.';
  end if;

  update public.jobs set status = 'installed', install_date = current_date - 5 where id = v_job;

  select count(*) into v_after from public.data_health()
  where job_id = v_job and check_key = 'install_overdue';

  if v_after <> 0 then
    raise exception 'The check still complains after the job was marked installed.';
  end if;

  delete from public.jobs where id = v_job;

  raise notice 'data_health found % things wrong, and goes quiet when one is fixed', v_rows;
end $$;
