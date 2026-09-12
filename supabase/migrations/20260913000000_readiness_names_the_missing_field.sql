-- Readiness says which field is missing, not how many are.
--
-- job_schedule_readiness returned unresolved_lines as a number, so the badge
-- could only ever say "Pick 2". That names the size of the problem and not the
-- problem, and it hands the work of finding it back to the person reading it:
-- open the job, open the parts list, compare each pick line against what the
-- job has, work out that nobody chose a faucet finish. The database already
-- knew that at the moment it counted, and threw it away.
--
-- So the count comes back with the pick sources beside it. "Faucet finish not
-- chosen" is the same answer with the search already done.
--
-- A line can also be unresolved without being a pick at all: a fixed line
-- whose item was removed from the sheet resolves to nothing and has no
-- pick_source. Those come back as 'fixed' rather than as null, so the caller
-- can say something true about them instead of dropping them from a list that
-- is supposed to account for every unresolved line.
--
-- The return type gains a column, which create or replace cannot do, so this
-- drops first. Nothing else references it by name in the database.

drop function if exists public.job_schedule_readiness(uuid[]);

create function public.job_schedule_readiness(p_job_ids uuid[])
returns table (
  job_id           uuid,
  checked          boolean,
  has_sheet        boolean,
  sheet_lines      int,
  unresolved_lines int,
  unresolved_picks text[],
  short_items      int,
  short_units      int
)
language plpgsql
stable
set search_path = public, pg_temp
as $fn$
begin
  if p_job_ids is null or array_length(p_job_ids, 1) is null then
    return;
  end if;

  return query
  select
    j.id,
    (j.status not in ('installed', 'cancelled') and j.parts_deducted_at is null),
    (j.template_id is not null or o.override),
    coalesce(u.lines, 0),
    coalesce(u.unresolved, 0),
    coalesce(u.picks, '{}'::text[]),
    coalesce(c.items, 0),
    coalesce(c.units, 0)
  from public.jobs j
  left join lateral (
    select exists (select 1 from public.job_parts jp where jp.job_id = j.id) as override
  ) o on true
  left join lateral (
    select
      count(*)::int                                   as items,
      coalesce(sum(greatest(k.shortfall, 0)), 0)::int as units
    from public.job_schedule_conflicts(j.id) k
  ) c on true
  left join lateral (
    select
      count(*) filter (where not r.resolved)::int as unresolved,
      count(*)::int                               as lines,
      -- distinct, because a sheet naming two faucets is still one decision
      array_remove(array_agg(distinct
        case when not r.resolved then coalesce(r.pick_source, 'fixed') end
      ), null) as picks
    from public.resolve_job_parts(j.id) r
  ) u on true
  where j.id = any(p_job_ids);
end;
$fn$;

grant execute on function public.job_schedule_readiness(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- prove it, against whatever is actually booked
--
-- A job with an unresolved pick has to name that pick. The two well jobs had
-- exactly this shape before their valve was chosen, which is the case this
-- exists for.
-- ---------------------------------------------------------------------------
do $$
declare
  v_job   uuid;
  v_row   record;
  v_picks text[];
begin
  select j.id into v_job
  from public.jobs j
  where j.status not in ('installed', 'cancelled')
    and j.parts_deducted_at is null
    and exists (select 1 from public.resolve_job_parts(j.id) r where not r.resolved)
  limit 1;

  if v_job is null then
    return;
  end if;

  select * into v_row from public.job_schedule_readiness(array[v_job]);

  if v_row.unresolved_lines = 0 then
    raise exception 'a job with an unresolved line reported none';
  end if;

  v_picks := v_row.unresolved_picks;

  if v_picks is null or array_length(v_picks, 1) is null then
    raise exception 'a job with % unresolved lines named no field', v_row.unresolved_lines;
  end if;

  if array_length(v_picks, 1) > v_row.unresolved_lines then
    raise exception 'more fields named than there are unresolved lines';
  end if;

  -- every entry has to be something the caller can turn into a sentence
  if exists (
    select 1 from unnest(v_picks) p
    where p not in ('faucet_finish', 'ro_type', 'valve_type', 'fixed')
  ) then
    raise exception 'unresolved_picks carried an unknown source: %', array_to_string(v_picks, ', ');
  end if;
end $$;

notify pgrst, 'reload schema';
