-- The 3 AM reconcile flagged "Won in GHL, no job here" for Mr Steve Burgess,
-- $1,200, though the job exists. It could never have matched:
--   name   GHL says "Mr Steve Burgess", the job says "Steve Burgess"
--   email  blank on both sides
--   signed the reconcile only looks at jobs with a completed customer
--          agreement, and the owner's house has none
-- A name and an email are guesses. The GHL opportunity id is not, so a job can
-- now carry it, and a job that carries it settles that opportunity whatever
-- its paperwork. Test jobs take no part in the reconcile.

alter table public.jobs
  add column if not exists ghl_opportunity_id text;

create unique index if not exists jobs_ghl_opportunity_id_key
  on public.jobs (ghl_opportunity_id)
  where ghl_opportunity_id is not null;

comment on column public.jobs.ghl_opportunity_id is
  'The GoHighLevel opportunity this job is. When set, the reconcile matches on it before email or name.';

update public.jobs
   set ghl_opportunity_id = 'xAcYNQb30MLuvCEvsL6X'
 where id = '1b9c240d-9eb9-4247-8bc3-7ab201bfd7ab'; -- Steve Burgess, own house, MWP-0016

create or replace function public.ghl_reconcile()
returns table (
  direction   text,
  ref_id      text,
  who         text,
  email       text,
  amount      numeric(12,2),
  matched_on  text,
  detail      text
)
language sql
stable
set search_path = public, pg_temp
as $reconcile$
  with signed as (
    select
      j.id::text                                as ref_id,
      j.customer_name                           as who,
      nullif(btrim(lower(j.customer_email)), '') as key_email,
      nullif(btrim(lower(j.customer_name)),  '') as key_name,
      j.ghl_opportunity_id                      as key_ghl,
      j.sale_price                              as amount,
      a.completed_at
    from public.jobs j
    join public.agreements a
      on a.job_id = j.id
     and a.type   = 'customer_install'
     and a.status = 'completed'
    where not j.is_test
  ),
  won as (
    select
      o.ghl_id                                     as ref_id,
      coalesce(o.contact_name, o.name)             as who,
      nullif(btrim(lower(o.contact_email)), '')    as key_email,
      nullif(btrim(lower(o.contact_name)),  '')    as key_name,
      o.monetary_value                             as amount,
      o.ghl_updated_at
    from public.ghl_opportunities o
    where o.status = 'won'
  )
  select
    'job_no_opportunity'::text,
    s.ref_id,
    s.who,
    s.key_email,
    s.amount,
    null::text,
    'Customer agreement signed'
      || coalesce(' on ' || to_char(s.completed_at, 'FMMonth FMDD'), '')
      || ', no won opportunity in GHL.'
  from signed s
  where not exists (
    select 1 from won w
    where (s.key_ghl   is not null and w.ref_id    = s.key_ghl)
       or (s.key_email is not null and w.key_email = s.key_email)
       or (s.key_name  is not null and w.key_name  = s.key_name)
  )

  union all

  select
    'opportunity_no_job'::text,
    w.ref_id,
    w.who,
    w.key_email,
    w.amount,
    null::text,
    'Won in GHL'
      || coalesce(' on ' || to_char(w.ghl_updated_at, 'FMMonth FMDD'), '')
      || ', no job written up here.'
  from won w
  where not exists (
    select 1 from signed s
    where (w.key_email is not null and s.key_email = w.key_email)
       or (w.key_name  is not null and s.key_name  = w.key_name)
  )
  -- any job holding the id settles it, signed or not, test jobs aside
  and not exists (
    select 1 from public.jobs j
    where j.ghl_opportunity_id = w.ref_id
      and not j.is_test
  )

  order by 1, 3;
$reconcile$;

revoke execute on function public.ghl_reconcile() from public, anon;
grant execute on function public.ghl_reconcile() to authenticated;
