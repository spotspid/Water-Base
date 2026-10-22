-- The rebuild, page by page, in a schema next door.
--
-- Water Base works and a business runs on it daily, so it is not being edited
-- into shape. A second schema is built alongside it, one page at a time, and
-- when it does the job the two are swapped:
--
--   alter schema public rename to archive_2026;
--   alter schema v2 rename to public;
--
-- That is the whole cutover. Every edge function, webhook and key says
-- "public", so none of them change and none of them need repointing. It
-- reverses in the same two statements if the first day goes badly.
--
-- Three rules make that swap possible, and this migration is where they start:
--
--   1. Nothing in v2 may reference public. Only auth.users, which sits outside
--      both. The moment v2 depends on an old table the schemas cannot be
--      renamed independently and the partition has leaked.
--   2. Every table carries org_id, from the first one. Adding it later means
--      revisiting every row to decide who owns it and rewriting every rule,
--      on a live system, which is the thing this rebuild exists to avoid.
--   3. Nothing may block a core verb. A job can be saved, scheduled and marked
--      installed whether or not anything else is known about it. Parts
--      resolution being a precondition of marking a job installed is what hid
--      $21,842 of revenue for three weeks in the system this replaces.

create schema if not exists v2;

comment on schema v2 is
  'The rebuild. Renamed over public at cutover, so nothing here may reference '
  'public: see check:v2 which fails the build if anything does.';

-- ---------------------------------------------------------------------------
-- Who the data belongs to
-- ---------------------------------------------------------------------------

create table if not exists v2.organizations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  active      boolean not null default true,
  constraint organizations_name_not_blank check (btrim(name) <> '')
);

comment on table v2.organizations is
  'One water business. Every other table points at this.';

-- Who may see an organisation's data. A person can belong to more than one,
-- which is what lets somebody run two businesses or lets us look at a dealer's
-- data with their permission rather than by bypassing the rules.
create table if not exists v2.memberships (
  user_id     uuid not null references auth.users (id) on delete cascade,
  org_id      uuid not null references v2.organizations (id) on delete cascade,
  role        text not null default 'member',
  created_at  timestamptz not null default now(),
  primary key (user_id, org_id),
  constraint memberships_role_known check (role in ('owner', 'member'))
);

-- The organisations the caller belongs to.
--
-- security definer so the policy on a table can ask this without the caller
-- needing to read memberships directly, and stable so Postgres calls it once
-- per statement rather than once per row.
create or replace function v2.my_orgs()
returns setof uuid
language sql
stable
security definer
set search_path to 'v2', 'pg_temp'
as $function$
  select org_id from v2.memberships where user_id = (select auth.uid())
$function$;

-- ---------------------------------------------------------------------------
-- The job
-- ---------------------------------------------------------------------------
--
-- One table, and it is the spine: a document cannot be sent and a day cannot
-- be scheduled without one.
--
-- Every field the documents need is here under the name send-agreement already
-- reads, so the function carries over without edits. The exception is the
-- parts list, which was resolved from inventory and is now plain text. An
-- installer needs to be told what to bring. He does not need it derived from a
-- stock database, and making that derivation a precondition of finishing a job
-- is what broke the system this replaces.

create table if not exists v2.jobs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references v2.organizations (id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- the customer
  customer_name     text not null,
  phone             text,
  customer_email    text,
  address           text,
  city              text,

  -- what was sold. Two names because the documents print the long one and the
  -- lists show the short one.
  system_name       text,
  system_description text,
  parts_list        text,

  -- the choices that print on a document. Plain text on purpose: they describe
  -- the job, they do not resolve to anything, and nothing refuses to save
  -- because one is blank.
  faucet_finish     text,
  ro_type           text,
  valve_type        text,
  water_source      text,
  site_conditions   text,

  -- money
  sale_price        numeric(10,2),
  deposit_amount    numeric(10,2),
  invoice_number    text,
  collected_by      text,

  -- the work
  status            text not null default 'quoted',
  scheduled_date    date,
  time_window       text,
  install_date      date,
  installer_name    text,
  installer_pay     numeric(10,2),

  notes             text,
  is_test           boolean not null default false,

  constraint jobs_customer_name_not_blank check (btrim(customer_name) <> ''),
  constraint jobs_status_known check (status in ('quoted', 'sold', 'scheduled', 'installed', 'cancelled')),
  constraint jobs_sale_price_sane check (sale_price is null or sale_price >= 0),
  constraint jobs_deposit_sane check (deposit_amount is null or deposit_amount >= 0),
  constraint jobs_pay_sane check (installer_pay is null or installer_pay >= 0)
);

-- Deliberately absent: a not null on anything but the customer's name and the
-- organisation. A quote often starts as a name and a phone number, and a form
-- that refuses to save what somebody actually knows sends them to do the work
-- somewhere else. That is not a guess: it is what happened on 2026-10-10, when
-- a $3,399 agreement was sent straight from DocuSeal and Water Base never
-- heard about the sale.

create index if not exists jobs_org_status_idx on v2.jobs (org_id, status);
create index if not exists jobs_org_scheduled_idx on v2.jobs (org_id, scheduled_date);

create or replace function v2.touch_updated_at()
returns trigger
language plpgsql
set search_path to 'v2', 'pg_temp'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists jobs_touch_updated_at on v2.jobs;

create trigger jobs_touch_updated_at
before update on v2.jobs
for each row execute function v2.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Who can see what
-- ---------------------------------------------------------------------------
--
-- The rule is membership, not "is signed in". In the schema this replaces,
-- every policy on all twenty five tables reads auth.uid() is not null, which
-- is correct for one company and a data breach for two.

alter table v2.organizations enable row level security;
alter table v2.memberships enable row level security;
alter table v2.jobs enable row level security;

drop policy if exists organizations_select on v2.organizations;
create policy organizations_select on v2.organizations
  for select to authenticated using (id in (select v2.my_orgs()));

drop policy if exists memberships_select on v2.memberships;
create policy memberships_select on v2.memberships
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists jobs_select on v2.jobs;
drop policy if exists jobs_insert on v2.jobs;
drop policy if exists jobs_update on v2.jobs;
drop policy if exists jobs_delete on v2.jobs;

create policy jobs_select on v2.jobs
  for select to authenticated using (org_id in (select v2.my_orgs()));
create policy jobs_insert on v2.jobs
  for insert to authenticated with check (org_id in (select v2.my_orgs()));
create policy jobs_update on v2.jobs
  for update to authenticated using (org_id in (select v2.my_orgs()));
create policy jobs_delete on v2.jobs
  for delete to authenticated using (org_id in (select v2.my_orgs()));

grant usage on schema v2 to authenticated;
grant select, insert, update, delete on v2.jobs to authenticated;
grant select on v2.organizations, v2.memberships to authenticated;
grant execute on function v2.my_orgs() to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Proof
-- ---------------------------------------------------------------------------

do $$
declare
  v_org   uuid;
  v_other uuid;
  v_count int;
  v_job   uuid;
begin
  -- 1. nothing in v2 points at public. The rename at cutover depends on it.
  select count(*) into v_count
  from pg_constraint c
  join pg_class child on child.oid = c.conrelid
  join pg_namespace cn on cn.oid = child.relnamespace
  join pg_class parent on parent.oid = c.confrelid
  join pg_namespace pn on pn.oid = parent.relnamespace
  where cn.nspname = 'v2' and pn.nspname = 'public';

  if v_count <> 0 then
    raise exception '% foreign keys point from v2 into public. The schemas cannot be swapped.', v_count;
  end if;

  -- 2. every table in v2 carries org_id, so tenancy cannot be forgotten later
  select count(*) into v_count
  from information_schema.tables t
  where t.table_schema = 'v2' and t.table_type = 'BASE TABLE'
    and t.table_name not in ('organizations', 'memberships')
    and not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'v2' and c.table_name = t.table_name
        and c.column_name = 'org_id');

  if v_count <> 0 then
    raise exception '% tables in v2 have no org_id.', v_count;
  end if;

  -- 3. a job saves with a name and nothing else, because that is often all
  --    anybody has when a call ends
  insert into v2.organizations (name) values ('Proof Only Org') returning id into v_org;
  insert into v2.jobs (org_id, customer_name) values (v_org, 'Just A Name') returning id into v_job;

  if v_job is null then
    raise exception 'A job could not be saved with only a customer name.';
  end if;

  -- 4. and it can reach installed without anything else being known, because
  --    no other fact may block a core verb
  update v2.jobs set status = 'installed', install_date = current_date where id = v_job;

  if (select status from v2.jobs where id = v_job) <> 'installed' then
    raise exception 'A job could not be marked installed.';
  end if;

  -- 5. the policies key on membership rather than on being signed in
  select count(*) into v_count
  from pg_policies
  where schemaname = 'v2' and qual is not null and qual not ilike '%my_orgs%'
    and tablename = 'jobs';

  if v_count <> 0 then
    raise exception '% policies on v2.jobs do not check membership.', v_count;
  end if;

  delete from v2.jobs where id = v_job;
  delete from v2.organizations where id = v_org;

  raise notice 'v2 stands alone, every table is tenanted, and a job saves on a name alone';
end $$;
