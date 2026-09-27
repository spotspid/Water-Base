-- Installer pay stops being a number somebody remembers.
--
-- The rate card has been a printed list on the quote form since it was added:
-- reference only, setting nothing, while the pay box beside it stayed free
-- text. That was honest when there was one installer and one card. With three
-- it stops working, because "the rate" is no longer one thing, and a figure
-- typed from memory is how Neil Toomey's job came to carry $1,600 against a
-- card that says $600.
--
-- Three tables, in the order they depend on each other:
--
--   install_rate_lines  the catalogue. One row per line on the card, base or
--                       extra, with the amount the business starts from.
--   installer_rates     what this installer is actually paid for that line.
--                       Absent means the catalogue amount stands, so a new
--                       installer works from day one without anybody filling
--                       in fourteen boxes first.
--   the mapping         two columns on system_templates, because which line
--                       applies depends on the sheet and on whether the job
--                       includes an RO. A Flagship Bundle with a tanked RO is
--                       a softener plus an RO install; the same sheet with No
--                       RO is just the softener.
--
-- The suggestion itself is a function rather than a column, so it answers with
-- today's rates rather than whatever they were when the job was written, and
-- says where the number came from. Nothing writes payout_amount: the job still
-- holds what somebody chose, and the form offers the figure beside it.

create table if not exists public.install_rate_lines (
  key            text primary key,
  label          text not null,
  kind           text not null check (kind in ('base', 'extra')),
  per            text,
  default_amount numeric(10,2) not null check (default_amount >= 0),
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);

comment on table public.install_rate_lines is
  'The install rate card: one row per line, base or extra. default_amount is '
  'what a new installer starts on until installer_rates says otherwise.';

create table if not exists public.installer_rates (
  installer_id uuid not null references public.installers(id) on delete cascade,
  rate_key     text not null references public.install_rate_lines(key) on delete cascade,
  amount       numeric(10,2) not null check (amount >= 0),
  updated_at   timestamptz not null default now(),
  primary key (installer_id, rate_key)
);

comment on table public.installer_rates is
  'What one installer is paid for one line. A missing row means the catalogue '
  'amount, so only the differences are stored.';

alter table public.install_rate_lines enable row level security;
alter table public.installer_rates enable row level security;

do $$
begin
  -- Same rule as installers and the build sheets: any signed in user reads and
  -- writes. The office is three people and one of them is the owner.
  if not exists (select 1 from pg_policies where tablename = 'install_rate_lines') then
    create policy install_rate_lines_select on public.install_rate_lines
      for select to authenticated using ((select auth.uid()) is not null);
    create policy install_rate_lines_insert on public.install_rate_lines
      for insert to authenticated with check ((select auth.uid()) is not null);
    create policy install_rate_lines_update on public.install_rate_lines
      for update to authenticated using ((select auth.uid()) is not null);
    create policy install_rate_lines_delete on public.install_rate_lines
      for delete to authenticated using ((select auth.uid()) is not null);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'installer_rates') then
    create policy installer_rates_select on public.installer_rates
      for select to authenticated using ((select auth.uid()) is not null);
    create policy installer_rates_insert on public.installer_rates
      for insert to authenticated with check ((select auth.uid()) is not null);
    create policy installer_rates_update on public.installer_rates
      for update to authenticated using ((select auth.uid()) is not null);
    create policy installer_rates_delete on public.installer_rates
      for delete to authenticated using ((select auth.uid()) is not null);
  end if;
end $$;

-- The card as it stood in src/lib/installRates.js, which is where it has lived
-- since it was agreed.
insert into public.install_rate_lines (key, label, kind, per, default_amount, sort_order) values
  ('softener',    'Softener plus brine tank',                                  'base',  null,                              400, 10),
  ('ro',          'Tankless or tanked RO, under sink',                         'base',  null,                              250, 20),
  ('dual',        'Dual tank setup, with or without brine tank',               'base',  null,                              500, 30),
  ('softener_ro', 'Softener plus brine tank, and RO install',                  'base',  null,                              500, 40),
  ('dual_ro',     'Dual tank setup with or without brine tank, and RO install','base',  null,                              600, 50),
  ('countertop',  'Drilling a stone or tile countertop',                       'extra', null,                               75, 60),
  ('fridge',      'Fridge hookup or extra faucet',                             'extra', 'each',                             75, 70),
  ('dishwasher',  'Electrical plug to the dishwasher',                         'extra', null,                               75, 80),
  ('bypass',      'Bypass valve',                                              'extra', null,                               50, 90),
  ('ro_basement', 'RO installed in the basement',                              'extra', 'on top of the normal RO price',    75, 100),
  ('long_run',    'Drain or supply line over 25 feet',                         'extra', 'per foot',                          4, 110),
  ('return_trip', 'Return trip',                                               'extra', null,                              175, 120),
  ('service_call','Service call',                                              'extra', null,                              175, 130)
on conflict (key) do nothing;

-- Jay is on the card as it stands, because the card is the deal that was
-- agreed with him. Storing it explicitly means changing his rate later does
-- not quietly change what the next installer starts on.
insert into public.installer_rates (installer_id, rate_key, amount)
select i.id, r.key, r.default_amount
from public.installers i
cross join public.install_rate_lines r
where i.name = 'Jay Woodward'
on conflict (installer_id, rate_key) do nothing;

-- Which line a sheet pays, with and without an RO on the job.
alter table public.system_templates
  add column if not exists rate_key         text references public.install_rate_lines(key),
  add column if not exists rate_key_with_ro text references public.install_rate_lines(key);

comment on column public.system_templates.rate_key is
  'The base rate line this sheet pays when the job has no RO.';
comment on column public.system_templates.rate_key_with_ro is
  'The base rate line when the job does include an RO. The same key as '
  'rate_key where the sheet has no RO line to exercise.';

update public.system_templates set rate_key = 'softener', rate_key_with_ro = 'softener_ro' where label = 'Flagship Bundle';
update public.system_templates set rate_key = 'dual',     rate_key_with_ro = 'dual_ro'     where label = 'Well Water Bundle';
update public.system_templates set rate_key = 'softener', rate_key_with_ro = 'softener'    where label = 'Softener Only';
update public.system_templates set rate_key = 'ro',       rate_key_with_ro = 'ro'          where label = 'RO Only';
-- Custom is deliberately unmapped: a sheet with no parts pays no known rate.

-- Every line of the card for one installer, theirs where they have one and the
-- catalogue amount where they do not, so a rate card can be printed for
-- anybody without the reader having to know which is which.
create or replace view public.installer_rate_card
with (security_invoker = true) as
select
  i.id                                        as installer_id,
  i.name                                      as installer_name,
  i.active                                    as installer_active,
  r.key                                       as rate_key,
  r.label,
  r.kind,
  r.per,
  r.default_amount,
  coalesce(ir.amount, r.default_amount)::numeric(10,2) as amount,
  ir.amount is not null                       as is_own_rate,
  r.sort_order
from public.installers i
cross join public.install_rate_lines r
left join public.installer_rates ir on ir.installer_id = i.id and ir.rate_key = r.key;

-- Which rate line each sheet resolves to, and whether it has an RO line to
-- exercise at all. Read by the report and by the suggestion below.
create or replace view public.template_rate_map
with (security_invoker = true) as
select
  t.id            as template_id,
  t.label,
  t.long_label,
  t.active,
  t.sort_order,
  t.rate_key,
  t.rate_key_with_ro,
  base.label      as rate_label,
  base.default_amount as rate_default,
  ro.label        as rate_label_with_ro,
  ro.default_amount as rate_default_with_ro,
  exists (
    select 1
    from public.template_lines l
    left join public.inventory_items it on it.id = l.item_id
    where l.template_id = t.id
      and (l.pick_source = 'ro_type' or it.category = 'RO')
  )               as has_ro_line,
  (select count(*) from public.template_lines l where l.template_id = t.id)::int as line_count
from public.system_templates t
left join public.install_rate_lines base on base.key = t.rate_key
left join public.install_rate_lines ro on ro.key = t.rate_key_with_ro;

/**
 * What this job's installer pay should be, and where the figure comes from.
 *
 * Returns one row always, so the form can say why there is no suggestion as
 * easily as it can show one. amount is null when nothing can be suggested.
 *
 * source:
 *   installer  this installer's own rate for the line
 *   card       the catalogue amount, because they have no rate of their own
 *   none       no suggestion, and reason says what is missing
 */
create or replace function public.suggested_installer_pay(p_job_id uuid)
returns table (
  amount        numeric,
  rate_key      text,
  rate_label    text,
  source        text,
  installer_id  uuid,
  installer_name text,
  has_ro        boolean,
  reason        text
)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job     public.jobs%rowtype;
  v_map     public.template_rate_map%rowtype;
  v_key     text;
  v_amount  numeric;
  v_own     boolean;
  v_name    text;
  v_has_ro  boolean;
  v_label   text;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    return query select null::numeric, null, null, 'none', null::uuid, null, false,
      'That job no longer exists.';
    return;
  end if;

  select name into v_name from public.installers where id = v_job.installer_id;

  if v_job.template_id is null then
    return query select null::numeric, null, null, 'none', v_job.installer_id, v_name, false,
      'This job has no build sheet, so there is no rate line to read.';
    return;
  end if;

  select * into v_map from public.template_rate_map where template_id = v_job.template_id;

  -- An RO is on this job when the sheet carries one and the job did not turn
  -- it off. A sheet with no RO line pays its base rate whatever the job says.
  v_has_ro := coalesce(v_map.has_ro_line, false)
    and coalesce(nullif(btrim(coalesce(v_job.ro_type, '')), ''), 'No RO') <> 'No RO';

  v_key := case when v_has_ro then v_map.rate_key_with_ro else v_map.rate_key end;

  if v_key is null then
    return query select null::numeric, null, null, 'none', v_job.installer_id, v_name, v_has_ro,
      format('The %s sheet has no rate line, so the pay has to be typed.', v_map.label);
    return;
  end if;

  select label into v_label from public.install_rate_lines where key = v_key;

  select ir.amount into v_amount
  from public.installer_rates ir
  where ir.installer_id = v_job.installer_id and ir.rate_key = v_key;

  v_own := v_amount is not null;

  if v_amount is null then
    select default_amount into v_amount from public.install_rate_lines where key = v_key;
  end if;

  return query select
    v_amount,
    v_key,
    v_label,
    case when v_own then 'installer' else 'card' end,
    v_job.installer_id,
    v_name,
    v_has_ro,
    case
      when v_own then format('%s is paid %s for %s.', v_name, to_char(v_amount, 'FM$999,999.00'), lower(v_label))
      when v_name is null then format('The rate card pays %s for %s. No installer is assigned yet.',
        to_char(v_amount, 'FM$999,999.00'), lower(v_label))
      else format('The rate card pays %s for %s. %s has no rate of their own yet.',
        to_char(v_amount, 'FM$999,999.00'), lower(v_label), v_name)
    end;
end;
$function$;

do $$
declare
  v_rate record;
  v_lines int;
begin
  select count(*) into v_lines from public.install_rate_lines;
  if v_lines <> 13 then
    raise exception 'expected 13 rate lines, found %', v_lines;
  end if;

  -- Jay carries his own card, so a change to the catalogue does not move his
  -- pay behind his back.
  if (select count(*) from public.installer_rates ir
      join public.installers i on i.id = ir.installer_id
      where i.name = 'Jay Woodward') <> 13 then
    raise exception 'Jay Woodward does not have the full card';
  end if;

  -- Bruce Weislik is a Softener Only with no RO, and his pay was typed as 400
  -- before any of this existed. If the mapping is right, it suggests the same.
  select * into v_rate from public.suggested_installer_pay(
    (select id from public.jobs where customer_name = 'Bruce Weislik'));
  if v_rate.amount <> 400 or v_rate.rate_key <> 'softener' then
    raise exception 'Bruce Weislik suggested % on %', v_rate.amount, v_rate.rate_key;
  end if;

  -- Essie Goodbar is an RO Only, typed as 250.
  select * into v_rate from public.suggested_installer_pay(
    (select id from public.jobs where customer_name = 'Essie Goodbar'));
  if v_rate.amount <> 250 or v_rate.rate_key <> 'ro' then
    raise exception 'Essie Goodbar suggested % on %', v_rate.amount, v_rate.rate_key;
  end if;

  -- And a Custom job says why it cannot answer rather than guessing.
  select * into v_rate from public.suggested_installer_pay(
    (select id from public.jobs where customer_name = 'Prudhvi Yalavarthi'));
  if v_rate.source <> 'none' or v_rate.reason not like '%no rate line%' then
    raise exception 'Custom answered % / %', v_rate.source, v_rate.reason;
  end if;
end $$;

notify pgrst, 'reload schema';
