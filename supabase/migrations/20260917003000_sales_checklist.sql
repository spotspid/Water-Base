-- The sales checklist, from the Sept 17 call.
--
-- What the salesperson finds out in the house so the install is not a second
-- visit: people in the home, bathrooms, where the main shutoff is, whether
-- there is room, power and a drain at the intake, irrigation lines, and
-- whether old equipment comes out and at what upcharge.
--
-- One jsonb object rather than eight columns. The questions will change
-- faster than the schema should, and nothing queries across jobs by them: they
-- are read back onto the job they belong to and two of them are printed on its
-- work order. src/lib/salesChecklist.js owns the shape, and check:checklist
-- tests it.
--
-- Faucet finish, RO type and payment type are part of the checklist on screen
-- but are not copied in here. They are already columns, and an answer that
-- lives in two places will eventually say two different things.
--
-- An unanswered item is absent from the object, not stored as null or an
-- empty string, so there is one way to be unanswered. Empty object by default,
-- so every existing job reads as a checklist nobody has started, which is true.
--
-- The work order reads this through its own select on jobs rather than
-- job_margin, so the view and pnl_monthly are not dropped and rebuilt for one
-- column. The function tolerates the column being absent, so deploying it
-- before this migration prints exactly what it printed before.

alter table public.jobs
  add column if not exists sales_checklist jsonb not null default '{}'::jsonb;

-- An object, never an array or a scalar. The app reads keys off it; a string
-- stored here by a bad write would read back as a blank checklist with no
-- error anywhere, which is worse than refusing the write.
alter table public.jobs
  drop constraint if exists jobs_sales_checklist_is_object;

alter table public.jobs
  add constraint jobs_sales_checklist_is_object
  check (jsonb_typeof(sales_checklist) = 'object');

comment on column public.jobs.sales_checklist is
  'Sales checklist answers from the quote visit. Unanswered items are absent. '
  'Shape owned by src/lib/salesChecklist.js.';

do $$
begin
  if exists (select 1 from public.jobs where sales_checklist is null) then
    raise exception 'a job has no sales_checklist object';
  end if;

  -- on a database with no jobs the update touches nothing and proves nothing
  if not exists (select 1 from public.jobs) then
    return;
  end if;

  begin
    update public.jobs set sales_checklist = '"not an object"'::jsonb
    where id = (select id from public.jobs limit 1);
    raise exception 'a non object checklist was accepted';
  exception
    when check_violation then null;
  end;
end $$;

notify pgrst, 'reload schema';
