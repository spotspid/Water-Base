-- What a quote is built from.
--
-- Two small tables so the quoting page has presets to offer and lines to add,
-- and so a dealer can change their own prices without anybody deploying.
--
-- Deliberately not a build sheet. A preset here carries a name, a price and a
-- parts list written as text. Nothing resolves to a SKU, nothing reserves
-- stock, and nothing about a quote can fail because a part was not found. That
-- coupling is what the rebuild exists to undo.

create table if not exists v2.system_presets (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references v2.organizations (id) on delete cascade,
  created_at   timestamptz not null default now(),
  name         text not null,
  description  text,
  -- What the installer is told to bring. Plain text on purpose.
  parts_list   text,
  price        numeric(10,2),
  sort_order   integer not null default 0,
  active       boolean not null default true,
  constraint system_presets_name_not_blank check (btrim(name) <> ''),
  constraint system_presets_price_sane check (price is null or price >= 0)
);

create unique index if not exists system_presets_org_name_key
  on v2.system_presets (org_id, lower(btrim(name)));

-- A priced thing that is added to a job on top of the system. The removal
-- upcharge and the irrigation reroute both already happen and both have been
-- carried as free text or a note until now.
create table if not exists v2.extras (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references v2.organizations (id) on delete cascade,
  created_at  timestamptz not null default now(),
  label       text not null,
  price       numeric(10,2) not null default 0,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  constraint extras_label_not_blank check (btrim(label) <> ''),
  constraint extras_price_sane check (price >= 0)
);

-- The extras chosen on one job, with the price copied at the time.
--
-- Copied rather than joined, for the same reason the ledger stamps a cost:
-- changing the price of a reroute next March must not change what a customer
-- agreed to in October.
create table if not exists v2.job_extras (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references v2.organizations (id) on delete cascade,
  job_id      uuid not null references v2.jobs (id) on delete cascade,
  created_at  timestamptz not null default now(),
  label       text not null,
  price       numeric(10,2) not null default 0,
  constraint job_extras_price_sane check (price >= 0)
);

create index if not exists job_extras_job_idx on v2.job_extras (job_id);

-- What the customer said was wrong with the water. Kept as text on the job
-- rather than as its own table: it is a sentence that prints on a document,
-- not something anybody will ever query.
alter table v2.jobs add column if not exists water_problems text;
alter table v2.jobs add column if not exists people_in_home integer;
alter table v2.jobs add column if not exists bathrooms integer;

alter table v2.system_presets enable row level security;
alter table v2.extras enable row level security;
alter table v2.job_extras enable row level security;

drop policy if exists system_presets_select on v2.system_presets;
drop policy if exists system_presets_insert on v2.system_presets;
drop policy if exists system_presets_update on v2.system_presets;
drop policy if exists system_presets_delete on v2.system_presets;

create policy system_presets_select on v2.system_presets
  for select to authenticated using (org_id in (select v2.my_orgs()));
create policy system_presets_insert on v2.system_presets
  for insert to authenticated with check (org_id in (select v2.my_orgs()));
create policy system_presets_update on v2.system_presets
  for update to authenticated using (org_id in (select v2.my_orgs()));
create policy system_presets_delete on v2.system_presets
  for delete to authenticated using (org_id in (select v2.my_orgs()));

drop policy if exists extras_select on v2.extras;
drop policy if exists extras_insert on v2.extras;
drop policy if exists extras_update on v2.extras;
drop policy if exists extras_delete on v2.extras;

create policy extras_select on v2.extras
  for select to authenticated using (org_id in (select v2.my_orgs()));
create policy extras_insert on v2.extras
  for insert to authenticated with check (org_id in (select v2.my_orgs()));
create policy extras_update on v2.extras
  for update to authenticated using (org_id in (select v2.my_orgs()));
create policy extras_delete on v2.extras
  for delete to authenticated using (org_id in (select v2.my_orgs()));

drop policy if exists job_extras_select on v2.job_extras;
drop policy if exists job_extras_insert on v2.job_extras;
drop policy if exists job_extras_update on v2.job_extras;
drop policy if exists job_extras_delete on v2.job_extras;

create policy job_extras_select on v2.job_extras
  for select to authenticated using (org_id in (select v2.my_orgs()));
create policy job_extras_insert on v2.job_extras
  for insert to authenticated with check (org_id in (select v2.my_orgs()));
create policy job_extras_update on v2.job_extras
  for update to authenticated using (org_id in (select v2.my_orgs()));
create policy job_extras_delete on v2.job_extras
  for delete to authenticated using (org_id in (select v2.my_orgs()));

grant select, insert, update, delete
  on v2.system_presets, v2.extras, v2.job_extras to authenticated;

-- The presets Michigan Water Pros sells today, at the prices set on the
-- 17 September call. Written out rather than copied from the old schema,
-- because v2 may not read public.
insert into v2.system_presets (org_id, name, description, price, sort_order, parts_list)
select o.id, x.name, x.description, x.price, x.sort_order, x.parts_list
from v2.organizations o
cross join (values
  ('Flagship Bundle',
   'Whole home single tank mixed bed system for filtration and softening, plus under sink tanked reverse osmosis for drinking water',
   2999.00, 10,
   '10x54 mixed bed system, control valve, tanked RO unit, alkaline filter, RO faucet, 2 bags of salt'),
  ('Well Water Bundle',
   'Whole home dual tank air injection well system for softening and filtration, plus under sink tanked reverse osmosis for drinking water',
   3799.00, 20,
   'Dual tank air injection well system, control valve, tanked RO unit, alkaline filter, RO faucet, 2 bags of salt'),
  ('Softener Only',
   'Whole home single tank water softener',
   2999.00, 30,
   'Single tank softener, control valve, 2 bags of salt'),
  ('Filtration Only',
   'Whole home single tank water filtration system',
   null, 40,
   'Carbon tank, control valve'),
  ('RO Only',
   'Under sink tanked reverse osmosis unit for perfectly clean drinking water',
   1200.00, 50,
   'Tanked RO unit, alkaline filter, RO faucet'),
  ('Custom',
   null, null, 60, null)
) as x(name, description, price, sort_order, parts_list)
where lower(o.name) = 'michigan water pros'
on conflict do nothing;

-- Starting extras. Every one of these has happened and been carried as a note.
-- Prices are a starting point for Steve to correct, not a quote from anybody.
insert into v2.extras (org_id, label, price, sort_order)
select o.id, x.label, x.price, x.sort_order
from v2.organizations o
cross join (values
  ('Remove and haul away the old equipment', 0.00, 10),
  ('Reroute the irrigation line', 550.00, 20),
  ('Extra drain run over 20 feet', 0.00, 30)
) as x(label, price, sort_order)
where lower(o.name) = 'michigan water pros'
on conflict do nothing;

notify pgrst, 'reload schema';

do $$
declare
  v_presets int;
  v_extras  int;
  v_org     uuid;
  v_job     uuid;
begin
  select id into v_org from v2.organizations where lower(name) = 'michigan water pros';

  select count(*) into v_presets from v2.system_presets where org_id = v_org;
  select count(*) into v_extras from v2.extras where org_id = v_org;

  if v_presets < 6 then
    raise exception 'Expected six presets, found %.', v_presets;
  end if;

  if v_extras < 3 then
    raise exception 'Expected three extras, found %.', v_extras;
  end if;

  -- A preset with no price is still offerable. Filtration Only and Custom both
  -- have none, and a page that refuses to show them would hide two thirds of
  -- what gets sold in a month.
  if not exists (select 1 from v2.system_presets where org_id = v_org and price is null) then
    raise exception 'A preset without a price should be allowed and none exists.';
  end if;

  -- An extra priced on a job keeps its own figure, so a later price change
  -- cannot rewrite what somebody already agreed to.
  insert into v2.jobs (org_id, customer_name) values (v_org, 'ZZ Preset Probe') returning id into v_job;
  insert into v2.job_extras (org_id, job_id, label, price) values (v_org, v_job, 'Reroute the irrigation line', 550.00);

  update v2.extras set price = 999.00 where org_id = v_org and label = 'Reroute the irrigation line';

  if (select price from v2.job_extras where job_id = v_job) <> 550.00 then
    raise exception 'Changing a price changed what a job had already agreed.';
  end if;

  update v2.extras set price = 550.00 where org_id = v_org and label = 'Reroute the irrigation line';
  delete from v2.jobs where id = v_job;

  raise notice 'six presets, three extras, and a job keeps the price it agreed';
end $$;
