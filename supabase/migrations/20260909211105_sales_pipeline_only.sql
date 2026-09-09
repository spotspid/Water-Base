-- The dashboard strip is about sales, so recruitment comes off it.
--
-- The GHL location runs two pipelines. One is the sales pipeline and one is
-- hiring, with stages like "New Viable Applicant" and "Hired!". Both arrived in
-- the same sync because both are opportunities as far as the API is concerned,
-- so two candidates were sitting in the open count and two recruitment stages
-- were drawn in the funnel beside Quote Sent.
--
-- Done as an exclusion rather than by naming the sales pipeline, and that is
-- the whole design decision here. Filtering to one known id would mean a
-- second sales pipeline added next year is silently absent, and absent is the
-- failure nobody notices. Excluding a named list means a new pipeline shows up
-- uninvited, which is visible, obviously wrong, and fixed by one insert.
--
-- The list is a table rather than a constant so hiding another pipeline is a
-- row somebody can add without a migration and without a deploy.

-- ---------------------------------------------------------------------------
-- the pipeline's name, so the exclusion list is readable
--
-- Without this the table below holds an opaque id and nobody can confirm it is
-- the right one without opening GoHighLevel.
-- ---------------------------------------------------------------------------
alter table public.ghl_opportunities
  add column if not exists pipeline_name text;

-- ---------------------------------------------------------------------------
-- what does not belong on the dashboard
-- ---------------------------------------------------------------------------
create table if not exists public.ghl_hidden_pipelines (
  pipeline_id text primary key,
  label       text,
  reason      text        not null,
  hidden_at   timestamptz not null default now()
);

alter table public.ghl_hidden_pipelines enable row level security;

drop policy if exists ghl_hidden_pipelines_read on public.ghl_hidden_pipelines;
create policy ghl_hidden_pipelines_read
  on public.ghl_hidden_pipelines
  for select
  to authenticated
  using ((select auth.uid()) is not null);

insert into public.ghl_hidden_pipelines (pipeline_id, label, reason)
values (
  '4YhsRd8QDUYaRyYTlRvY',
  'Hiring',
  'Recruitment, not sales. Its opportunities are job applicants, so counting '
  'them as open deals overstates the pipeline and its stages are meaningless '
  'in a sales funnel.'
)
on conflict (pipeline_id) do nothing;

-- ---------------------------------------------------------------------------
-- both views, filtered
--
-- The opportunities table is untouched. Everything GHL reports is still stored
-- and still reconcilable; this decides only what the dashboard draws, so
-- unhiding a pipeline needs no resync.
-- ---------------------------------------------------------------------------
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
from public.ghl_opportunities o
where not exists (
  select 1 from public.ghl_hidden_pipelines h where h.pipeline_id = o.pipeline_id
);

create or replace view public.ghl_stage_funnel
with (security_invoker = true) as
select
  coalesce(nullif(btrim(o.stage_name), ''), 'Unnamed stage') as stage_name,
  o.stage_id,
  count(*)::int                                              as opportunities,
  coalesce(sum(o.monetary_value), 0)::numeric(12,2)          as value
from public.ghl_opportunities o
where o.status = 'open'
  and not exists (
    select 1 from public.ghl_hidden_pipelines h where h.pipeline_id = o.pipeline_id
  )
group by 1, 2
order by count(*) desc, 1;

-- ---------------------------------------------------------------------------
-- the reconcile is deliberately NOT filtered
--
-- Hiding a pipeline from a chart is cosmetic. Hiding it from the reconcile
-- would mean a won opportunity nobody ever writes up as a job stops being
-- reported, which is the one thing that check exists to catch. If a
-- recruitment opportunity is ever marked won it should appear there and be
-- dealt with, not disappear because somebody tidied a funnel.
-- ---------------------------------------------------------------------------

do $$
declare
  v_hidden  int;
  v_summary int;
  v_stages  int;
begin
  select count(*) into v_hidden
  from public.ghl_opportunities o
  join public.ghl_hidden_pipelines h on h.pipeline_id = o.pipeline_id;

  select total_count into v_summary from public.ghl_pipeline_summary;

  if v_summary <> (select count(*) from public.ghl_opportunities) - v_hidden then
    raise exception
      'the summary counts % of % opportunities with % hidden, which does not add up',
      v_summary, (select count(*) from public.ghl_opportunities), v_hidden;
  end if;

  select count(*) into v_stages
  from public.ghl_stage_funnel f
  where exists (
    select 1
    from public.ghl_opportunities o
    join public.ghl_hidden_pipelines h on h.pipeline_id = o.pipeline_id
    where o.stage_id = f.stage_id
  );

  if v_stages <> 0 then
    raise exception '% hidden stage(s) are still drawn in the funnel', v_stages;
  end if;
end $$;

notify pgrst, 'reload schema';
