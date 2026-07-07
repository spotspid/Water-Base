-- jobs table
create table if not exists public.jobs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  customer_name    text not null,
  phone            text not null,
  address          text not null,
  city             text not null,
  water_source     text not null check (water_source in ('city', 'well')),
  system_template  text not null default 'Flagship Bundle',
  sale_price       numeric(10,2) not null,
  payment_type     text not null,
  faucet_finish    text not null,
  status           text not null default 'sold' check (status in ('sold', 'scheduled', 'installed')),
  install_date     date,
  installer        text,
  payout_amount    numeric(10,2),
  invoice_number   text not null,
  notes            text
);

-- enable RLS
alter table public.jobs enable row level security;

-- policies (drop first so this is idempotent)
drop policy if exists "jobs_select" on public.jobs;
drop policy if exists "jobs_insert" on public.jobs;
drop policy if exists "jobs_update" on public.jobs;
drop policy if exists "jobs_delete" on public.jobs;

create policy "jobs_select" on public.jobs
  for select to authenticated
  using ((select auth.uid()) is not null);

create policy "jobs_insert" on public.jobs
  for insert to authenticated
  with check ((select auth.uid()) is not null);

create policy "jobs_update" on public.jobs
  for update to authenticated
  using ((select auth.uid()) is not null);

create policy "jobs_delete" on public.jobs
  for delete to authenticated
  using ((select auth.uid()) is not null);

-- reload PostgREST schema cache
notify pgrst, 'reload schema';
