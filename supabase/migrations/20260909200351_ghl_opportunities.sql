-- What the CRM thinks is happening, kept beside what the shop knows.
--
-- Inbound only. Nothing here writes to GoHighLevel and nothing here creates a
-- job. David writes jobs by hand; this exists so the two systems can be
-- compared, and so a sale that was closed in the CRM and never written up here
-- stops being invisible until somebody notices the money missing.
--
-- Stages are stored exactly as GHL reports them. Mapping them to our own
-- vocabulary would mean this file has an opinion about a pipeline it does not
-- own, and the first time somebody renames a stage in the CRM the mapping
-- would quietly send opportunities to the wrong bucket. The stage id is kept
-- alongside the name for the same reason: the name is what a human reads, the
-- id is what survives a rename.

-- ---------------------------------------------------------------------------
-- the opportunities themselves
-- ---------------------------------------------------------------------------
create table if not exists public.ghl_opportunities (
  ghl_id          text primary key,
  location_id     text        not null,
  name            text,

  -- the contact, denormalised on purpose. The reconcile matches on email and
  -- then on name, and joining out to a contacts table we do not sync would
  -- make that a second integration to keep alive.
  contact_id      text,
  contact_name    text,
  contact_email   text,
  contact_phone   text,

  pipeline_id     text,
  stage_id        text,
  stage_name      text,

  -- GHL's own words: open, won, lost, abandoned. Not constrained, because a
  -- status we have not seen before must land in the table and be visible
  -- rather than fail the sync and leave the whole pipeline stale.
  status          text        not null,
  monetary_value  numeric(12,2),

  ghl_created_at  timestamptz,
  ghl_updated_at  timestamptz,

  -- ours, not theirs. Answers "is this picture current" without asking GHL.
  synced_at       timestamptz not null default now(),

  constraint ghl_opportunities_status_not_blank check (btrim(status) <> '')
);

-- The reconcile matches on a trimmed lower cased email, so the index has to be
-- on the same expression or it will never be used.
create index if not exists ghl_opportunities_email_idx
  on public.ghl_opportunities (lower(btrim(contact_email)))
  where contact_email is not null;

create index if not exists ghl_opportunities_name_idx
  on public.ghl_opportunities (lower(btrim(contact_name)))
  where contact_name is not null;

create index if not exists ghl_opportunities_status_idx
  on public.ghl_opportunities (status);

alter table public.ghl_opportunities enable row level security;

-- Readable by anyone signed in, written only by the service role. The sync is
-- the only writer, and a signed in user editing what the CRM said would make
-- the reconcile compare our edit against itself.
drop policy if exists ghl_opportunities_read on public.ghl_opportunities;
create policy ghl_opportunities_read
  on public.ghl_opportunities
  for select
  to authenticated
  using ((select auth.uid()) is not null);

-- ---------------------------------------------------------------------------
-- the dashboard's two questions
-- ---------------------------------------------------------------------------

-- One row. Counts and value by status, plus how stale the picture is.
create or replace view public.ghl_pipeline_summary
with (security_invoker = true) as
select
  count(*) filter (where o.status = 'open')::int                              as open_count,
  count(*) filter (where o.status = 'won')::int                               as won_count,
  count(*) filter (where o.status = 'lost')::int                              as lost_count,
  count(*) filter (where o.status not in ('open','won','lost'))::int          as other_count,
  coalesce(sum(o.monetary_value) filter (where o.status = 'open'), 0)::numeric(12,2) as open_value,
  coalesce(sum(o.monetary_value) filter (where o.status = 'won'),  0)::numeric(12,2) as won_value,
  max(o.synced_at)                                                            as last_synced_at,
  count(*)::int                                                               as total_count
from public.ghl_opportunities o;

-- The funnel, open work only. A won opportunity has left the funnel, and
-- leaving it in would make the widest band the one nobody has to act on.
create or replace view public.ghl_stage_funnel
with (security_invoker = true) as
select
  coalesce(nullif(btrim(o.stage_name), ''), 'Unnamed stage') as stage_name,
  o.stage_id,
  count(*)::int                                              as opportunities,
  coalesce(sum(o.monetary_value), 0)::numeric(12,2)          as value
from public.ghl_opportunities o
where o.status = 'open'
group by 1, 2
order by count(*) desc, 1;

-- ---------------------------------------------------------------------------
-- the reconcile
--
-- Two questions, asked in both directions, because each catches a different
-- failure:
--
--   a signed job with no won opportunity   the CRM never learned the sale
--                                          closed, so forecasting and any
--                                          commission read off it is wrong
--   a won opportunity with no job          somebody closed a sale that was
--                                          never written up here, which is
--                                          the expensive one: no parts are
--                                          reserved and nobody is scheduled
--
-- Matching is email first and then name, because an email is unique and a name
-- is a guess. Both are trimmed and lower cased. A blank on either side never
-- matches anything, which is why the nullif is there: without it two rows with
-- no email would match each other and hide a real gap.
-- ---------------------------------------------------------------------------
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
      j.sale_price                              as amount,
      a.completed_at
    from public.jobs j
    join public.agreements a
      on a.job_id = j.id
     and a.type   = 'customer_install'
     and a.status = 'completed'
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
    where (s.key_email is not null and w.key_email = s.key_email)
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

  order by 1, 3;
$reconcile$;

comment on function public.ghl_reconcile() is
  'Signed jobs with no won GHL opportunity, and won GHL opportunities with no '
  'job. Matches on email then name. Read only: it never creates anything.';

revoke execute on function public.ghl_reconcile() from public, anon;
grant execute on function public.ghl_reconcile() to authenticated;

-- ---------------------------------------------------------------------------
-- one bridge from the schedule to an edge function, instead of two
--
-- trigger_notify already did this for the notifier and hardcoded its slug. A
-- second copy for the GHL sync would mean two places holding the vault lookup
-- and the fallback url, and they would drift. This generalises it and leaves
-- trigger_notify as a thin wrapper, so the running nag and drain schedules
-- keep calling exactly what they always called.
-- ---------------------------------------------------------------------------
create or replace function public.trigger_edge_function(p_slug text, p_body jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_key        text;
  v_url        text;
  v_request_id bigint;
begin
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'No function slug was given to call.' using errcode = 'WB020';
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_key is null or v_key = '' then
    raise exception
      'No service_role_key in the vault, so the schedule cannot authenticate. '
      'Add it with: select vault.create_secret(''<key>'', ''service_role_key'');'
      using errcode = 'no_data_found';
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  v_url := coalesce(nullif(v_url, ''), 'https://vztoleozeqlloaadppnt.supabase.co');

  select net.http_post(
    url     := v_url || '/functions/v1/' || p_slug,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := p_body,
    timeout_milliseconds := 55000
  ) into v_request_id;

  return v_request_id;
end;
$fn$;

revoke execute on function public.trigger_edge_function(text, jsonb) from public, anon, authenticated;

create or replace function public.trigger_notify(p_body jsonb)
returns bigint
language sql
security definer
set search_path = public, extensions, pg_temp
as $fn$
  select public.trigger_edge_function('notify', p_body);
$fn$;

revoke execute on function public.trigger_notify(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- the schedule
--
-- Sync hourly at :05, which keeps it clear of the drain at :20.
--
-- The reconcile runs overnight and fires at both 07:00 and 08:00 UTC for the
-- same reason the morning nag fires twice: 3am Eastern is one or the other
-- depending on daylight saving. The function checks the Eastern clock and does
-- the work on exactly one of them, and the dedupe key is per calendar day, so
-- even if that check were wrong the second run posts nothing.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('ghl-sync-opportunities');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('ghl-reconcile');
exception when others then null;
end $$;

select cron.schedule(
  'ghl-sync-opportunities',
  '5 * * * *',
  $cron$select public.trigger_edge_function('ghl-sync', '{"mode":"sync"}'::jsonb)$cron$
);

select cron.schedule(
  'ghl-reconcile',
  '0 7,8 * * *',
  $cron$select public.trigger_edge_function('ghl-sync', '{"mode":"reconcile"}'::jsonb)$cron$
);

-- ---------------------------------------------------------------------------
-- prove it, so a broken migration cannot apply quietly
-- ---------------------------------------------------------------------------
do $$
declare
  v_rows int;
begin
  -- the reconcile runs against an empty opportunities table without throwing,
  -- which is the state it is in the moment this migration finishes
  select count(*) into v_rows from public.ghl_reconcile();

  -- with nothing synced, every signed job is unmatched and nothing points the
  -- other way. That is the correct answer, not an error.
  if v_rows <> (
    select count(*) from public.jobs j
    join public.agreements a on a.job_id = j.id
     and a.type = 'customer_install' and a.status = 'completed'
  ) then
    raise exception
      'reconcile on an empty pipeline returned % rows, expected one per signed job',
      v_rows;
  end if;

  if not exists (select 1 from cron.job where jobname = 'ghl-sync-opportunities') then
    raise exception 'the hourly GHL sync did not schedule';
  end if;

  if not exists (select 1 from cron.job where jobname = 'ghl-reconcile') then
    raise exception 'the overnight reconcile did not schedule';
  end if;
end $$;

notify pgrst, 'reload schema';
