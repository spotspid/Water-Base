-- The overheads that arrive every month whether anyone types them or not.
--
-- Ad spend and software subscriptions are not one-off expenses. The CRM bills
-- on the same day every month for the same amount, and Meta bills every month
-- for a different one. Both were being entered by hand, which means a month
-- nobody remembers is a month the P&L says the business earned more than it
-- did. That error only ever points one way: too profitable.
--
-- A standing cost is described once here. Posting it writes an ordinary row
-- into expenses, so the P&L, the category chips and the date filters all keep
-- working with no knowledge of this table.
--
-- Two kinds, because two things are true:
--
--   A fixed cost knows its own amount, so it can post without being asked.
--   A varying cost does not. Ad spend is whatever Meta charged, and this file
--   refuses to guess: a varying cost posts nothing until somebody reads the
--   real number off the platform and types it. It shows as due and unpaid
--   rather than quietly posting last month's figure, because a number that is
--   confidently wrong is worse than a gap that is obviously a gap.
--
-- Posting is idempotent on (recurring_id, period_month). Pressing the button
-- twice, two people pressing it at once, or a retry after a dropped
-- connection all leave one row, enforced by a unique index rather than by the
-- caller remembering.

-- ---------------------------------------------------------------------------
-- the standing costs
-- ---------------------------------------------------------------------------

create table if not exists public.expense_recurring (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  vendor       text not null,
  category     text not null,
  -- null exactly when the amount varies. The check below ties the two together
  -- so there is no such thing as a fixed cost with no amount.
  amount       numeric(12,2),
  amount_varies boolean not null default false,
  -- 1..28 only. The 29th, 30th and 31st do not exist in every month, and a
  -- cost that skips February is a cost that silently under-reports once a
  -- year. Anything billed later in the month is set to 28.
  day_of_month integer not null default 1,
  active       boolean not null default true,
  note         text,

  constraint expense_recurring_vendor_not_blank check (btrim(vendor) <> ''),
  constraint expense_recurring_category_not_blank check (btrim(category) <> ''),
  constraint expense_recurring_day_in_every_month check (day_of_month between 1 and 28),
  constraint expense_recurring_amount_matches_kind check (
    (amount_varies and amount is null)
    or (not amount_varies and amount is not null and amount > 0)
  )
);

comment on table public.expense_recurring is
  'Standing monthly overheads. Posting one writes an ordinary row into expenses.';
comment on column public.expense_recurring.amount_varies is
  'True when the real figure has to be read off the platform each month, as ad spend does. Such a cost never posts automatically.';

-- ---------------------------------------------------------------------------
-- a third way an expense can arrive
-- ---------------------------------------------------------------------------
--
-- source was manual or import. A posted standing cost is neither: nobody
-- typed it and it came from no file. Calling it manual would put "Manual" in
-- the Source column of a row no person entered, so the column gains the
-- truthful third value instead.

alter table public.expenses drop constraint if exists expenses_source_check;
alter table public.expenses
  add constraint expenses_source_check
  check (source = any (array['manual'::text, 'import'::text, 'recurring'::text]));

-- Only an import carries a batch. A recurring row is grouped by its parent
-- and its month, not by a batch.
alter table public.expenses drop constraint if exists expenses_batch_matches_source;
alter table public.expenses
  add constraint expenses_batch_matches_source
  check (
    (source = 'import' and import_batch is not null)
    or (source in ('manual', 'recurring') and import_batch is null)
  );

-- ---------------------------------------------------------------------------
-- what a posted row remembers
-- ---------------------------------------------------------------------------

alter table public.expenses
  add column if not exists recurring_id uuid references public.expense_recurring(id) on delete set null,
  add column if not exists period_month date;

comment on column public.expenses.period_month is
  'The month a recurring cost was posted for, as its first day. Null on an ordinary expense.';

-- One posting per cost per month. This is the whole of the double posting
-- guard: the caller does not get to be careful instead.
create unique index if not exists expenses_one_per_recurring_month
  on public.expenses (recurring_id, period_month)
  where recurring_id is not null;

-- A recurring row carries both or neither, so a row claiming a parent with no
-- month cannot slip past the unique index above.
alter table public.expenses
  drop constraint if exists expenses_recurring_has_a_month;

alter table public.expenses
  add constraint expenses_recurring_has_a_month check (
    (recurring_id is null and period_month is null)
    or (recurring_id is not null and period_month is not null
        and period_month = date_trunc('month', period_month)::date)
  );

-- ---------------------------------------------------------------------------
-- what is owed this month, and what has been paid
-- ---------------------------------------------------------------------------

create or replace view public.recurring_expense_status
with (security_invoker = true) as
select
  r.id,
  r.vendor,
  r.category,
  r.amount,
  r.amount_varies,
  r.day_of_month,
  r.active,
  r.note,
  date_trunc('month', current_date)::date as period_month,
  make_date(
    extract(year from current_date)::int,
    extract(month from current_date)::int,
    r.day_of_month
  ) as due_on,
  e.id     as expense_id,
  e.amount as posted_amount,
  -- Three states and no fourth. Posted, or waiting on a number only a person
  -- can supply, or ready to post itself.
  case
    when e.id is not null then 'posted'
    when r.amount_varies then 'needs_amount'
    else 'due'
  end as state
from public.expense_recurring r
left join public.expenses e
  on e.recurring_id = r.id
 and e.period_month = date_trunc('month', current_date)::date
where r.active;

comment on view public.recurring_expense_status is
  'Every active standing cost against the current month: posted, due, or waiting on a figure somebody has to read off the platform.';

-- ---------------------------------------------------------------------------
-- posting
-- ---------------------------------------------------------------------------

/*
 * Post one standing cost for one month.
 *
 * p_amount is required for a varying cost and refused for a fixed one: a
 * fixed cost that needed overriding this month is a different amount than the
 * one on record, and editing the posted expense is the honest way to say so.
 *
 * Returns the expense id, whether it wrote a new row or found one already
 * there, so pressing the button twice reports the truth rather than an error.
 */
create or replace function public.post_recurring_expense(
  p_recurring_id uuid,
  p_period_month date default date_trunc('month', current_date)::date,
  p_amount numeric default null
)
returns table (expense_id uuid, already_posted boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.expense_recurring%rowtype;
  v_month date := date_trunc('month', p_period_month)::date;
  v_amount numeric;
  v_existing uuid;
begin
  select * into r from public.expense_recurring where id = p_recurring_id;
  if not found then
    raise exception 'That recurring cost no longer exists.';
  end if;
  if not r.active then
    raise exception 'The recurring cost for % is switched off. Turn it back on before posting it.', r.vendor;
  end if;

  if r.amount_varies then
    if p_amount is null then
      raise exception 'Ad spend and anything else that varies needs this month''s actual amount for %.', r.vendor;
    end if;
    -- expenses refuses an amount of zero, so refuse it here where the person
    -- can see which cost is being complained about.
    if p_amount <= 0 then
      raise exception 'Enter what % actually charged this month. An expense cannot be zero or negative.', r.vendor;
    end if;
    v_amount := p_amount;
  else
    if p_amount is not null and p_amount <> r.amount then
      raise exception 'The cost for % is set to a fixed %. Post it, then edit the expense if this month was different.',
        r.vendor, r.amount;
    end if;
    v_amount := r.amount;
  end if;

  -- Already there, from an earlier press or another person. Report it rather
  -- than raising: the caller wanted this month posted, and it is.
  select id into v_existing
  from public.expenses
  where recurring_id = r.id and period_month = v_month;

  if v_existing is not null then
    return query select v_existing, true;
    return;
  end if;

  insert into public.expenses (spent_on, amount, vendor, category, description, source,
                               recurring_id, period_month)
  values (
    make_date(extract(year from v_month)::int, extract(month from v_month)::int, r.day_of_month),
    v_amount, r.vendor, r.category,
    coalesce(nullif(btrim(r.note), ''), 'Monthly ' || r.category || ' for ' || r.vendor),
    'recurring', r.id, v_month
  )
  returning id into v_existing;

  return query select v_existing, false;

exception
  -- Two people pressed it at the same moment. The index decided; report the
  -- row that won rather than failing the one that lost.
  when unique_violation then
    select id into v_existing
    from public.expenses
    where recurring_id = r.id and period_month = v_month;
    return query select v_existing, true;
end $$;

comment on function public.post_recurring_expense is
  'Posts one standing cost into expenses for one month. Idempotent: a second call returns the row the first one wrote.';

/*
 * Post every fixed cost that is due this month and has not been posted.
 *
 * Varying costs are deliberately skipped. They have no amount to post and
 * this function will not invent one; they surface through
 * recurring_expense_status as needs_amount until a person supplies the figure.
 */
create or replace function public.post_due_recurring_expenses(
  p_period_month date default date_trunc('month', current_date)::date
)
returns table (expense_id uuid, vendor text, amount numeric)
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  v_id uuid;
  v_already boolean;
begin
  -- Aliased, because this function returns columns called vendor and amount
  -- and an unqualified reference to either is the OUT parameter, not the
  -- table's column.
  for r in
    select rec.id, rec.vendor from public.expense_recurring rec
    where rec.active and not rec.amount_varies
    order by rec.vendor
  loop
    select p.expense_id, p.already_posted into v_id, v_already
    from public.post_recurring_expense(r.id, p_period_month) p;

    if not v_already then
      return query
        select e.id, e.vendor, e.amount from public.expenses e where e.id = v_id;
    end if;
  end loop;
end $$;

comment on function public.post_due_recurring_expenses is
  'Posts every fixed standing cost not yet posted for the month. Returns only what it actually wrote. Varying costs are never posted automatically.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.expense_recurring enable row level security;

drop policy if exists "expense_recurring_select" on public.expense_recurring;
drop policy if exists "expense_recurring_insert" on public.expense_recurring;
drop policy if exists "expense_recurring_update" on public.expense_recurring;
drop policy if exists "expense_recurring_delete" on public.expense_recurring;

create policy "expense_recurring_select" on public.expense_recurring
  for select to authenticated using ((select auth.uid()) is not null);
create policy "expense_recurring_insert" on public.expense_recurring
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy "expense_recurring_update" on public.expense_recurring
  for update to authenticated using ((select auth.uid()) is not null);
create policy "expense_recurring_delete" on public.expense_recurring
  for delete to authenticated using ((select auth.uid()) is not null);

-- ---------------------------------------------------------------------------
-- proof
-- ---------------------------------------------------------------------------

do $$
declare
  v_fixed uuid;
  v_varies uuid;
  v_month date := date_trunc('month', current_date)::date;
  v_a uuid;
  v_b uuid;
  v_already boolean;
  v_count integer;
begin
  insert into public.expense_recurring (vendor, category, amount, day_of_month)
  values ('PROOF fixed vendor', 'Software and Subscriptions', 49.00, 5)
  returning id into v_fixed;

  insert into public.expense_recurring (vendor, category, amount_varies, day_of_month)
  values ('PROOF varying vendor', 'Advertising', true, 3)
  returning id into v_varies;

  -- a fixed cost posts, and posts once
  select p.expense_id into v_a from public.post_recurring_expense(v_fixed, v_month) p;
  select p.expense_id, p.already_posted into v_b, v_already
  from public.post_recurring_expense(v_fixed, v_month) p;

  if v_a is null or v_a <> v_b then
    raise exception 'posting twice made two rows';
  end if;
  if not v_already then
    raise exception 'the second post did not report itself as already there';
  end if;

  select count(*) into v_count from public.expenses
  where recurring_id = v_fixed and period_month = v_month;
  if v_count <> 1 then
    raise exception 'expected one posted row, found %', v_count;
  end if;

  -- a varying cost refuses to guess
  begin
    perform public.post_recurring_expense(v_varies, v_month);
    raise exception 'a varying cost posted with no amount';
  exception
    when others then
      if sqlerrm like '%posted with no amount%' then raise; end if;
  end;

  -- and posts once it is given the real number
  select p.expense_id into v_a from public.post_recurring_expense(v_varies, v_month, 812.44) p;
  if v_a is null then
    raise exception 'a varying cost would not post with an amount';
  end if;
  select count(*) into v_count from public.expenses
  where recurring_id = v_varies and period_month = v_month and amount = 812.44;
  if v_count <> 1 then
    raise exception 'the varying amount was not what got written';
  end if;

  -- the automatic pass never touches a varying cost
  delete from public.expenses where recurring_id in (v_fixed, v_varies);
  perform public.post_due_recurring_expenses(v_month);

  select count(*) into v_count from public.expenses where recurring_id = v_varies;
  if v_count <> 0 then
    raise exception 'the automatic pass invented an amount for a varying cost';
  end if;
  select count(*) into v_count from public.expenses where recurring_id = v_fixed;
  if v_count <> 1 then
    raise exception 'the automatic pass did not post the fixed cost';
  end if;

  -- the posted row says where it came from, and carries no batch
  select count(*) into v_count from public.expenses
  where recurring_id = v_fixed and source = 'recurring' and import_batch is null;
  if v_count <> 1 then
    raise exception 'a posted cost does not read as recurring';
  end if;

  -- zero is refused where the person can see which cost it was
  begin
    perform public.post_recurring_expense(v_varies, v_month, 0);
    raise exception 'a zero amount was accepted';
  exception
    when others then
      if sqlerrm like '%zero amount was accepted%' then raise; end if;
  end;

  -- a day that does not exist in February is refused
  begin
    insert into public.expense_recurring (vendor, category, amount, day_of_month)
    values ('PROOF bad day', 'Other', 1.00, 31);
    raise exception 'a 31st of the month cost was accepted';
  exception
    when check_violation then null;
  end;

  -- a fixed cost with no amount is refused
  begin
    insert into public.expense_recurring (vendor, category, amount_varies)
    values ('PROOF no amount', 'Other', false);
    raise exception 'a fixed cost with no amount was accepted';
  exception
    when check_violation then null;
  end;

  -- the status view says the right thing about each
  perform 1 from public.recurring_expense_status
  where id = v_fixed and state = 'posted';
  if not found then raise exception 'the view does not report the fixed cost as posted'; end if;

  perform 1 from public.recurring_expense_status
  where id = v_varies and state = 'needs_amount';
  if not found then raise exception 'the view does not ask for the varying amount'; end if;

  -- leave nothing behind
  delete from public.expenses where recurring_id in (v_fixed, v_varies);
  delete from public.expense_recurring where id in (v_fixed, v_varies);
  delete from public.expense_recurring where vendor like 'PROOF %';
end $$;

notify pgrst, 'reload schema';
