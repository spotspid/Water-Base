-- Can the van be loaded for this job.
--
-- The schedule showed who and where and said nothing about parts, so the one
-- question the brand kit sets as its design test, "at a glance, can an operator
-- tell whether Thursday's install has every required part", could only be
-- answered by opening each job in turn and reading the modal.
--
-- The check already existed. job_schedule_conflicts answers it for one job, and
-- the scheduling modal has always called it. What was missing was a way to ask
-- it about the twenty jobs on screen without twenty round trips.
--
-- So this does not decide anything about shortages itself. It calls
-- job_schedule_conflicts once per job through a lateral join and counts what
-- comes back. There is exactly one definition of "short" in the database, and
-- the card and the modal are reading the same one, which is the point: a card
-- that said ready over a modal that said short would be worse than no card.
--
-- Two things conflicts deliberately does not cover, because they are not
-- conflicts, and the card needs them:
--
--   unresolved  a build sheet line whose part depends on a choice nobody has
--               made yet. resolve_template_parts reports it, and
--               job_schedule_conflicts skips those lines on purpose, because
--               a part nobody has picked cannot be short.
--   empty       a sheet with no lines at all resolves cleanly, since nothing
--               to resolve cannot fail. It reads as ready and means the
--               opposite. The same trap 20260906000000 closed for work orders.
--
-- Facts only, no wording. Which of these matters most and what it should say
-- is in src/lib/readiness.js, so the sentence on the card can be changed and
-- tested without a migration.

create or replace function public.job_schedule_readiness(p_job_ids uuid[])
returns table (
  job_id           uuid,
  checked          boolean,
  has_sheet        boolean,
  sheet_lines      integer,
  unresolved_lines integer,
  short_items      integer,
  short_units      integer
)
language plpgsql
stable
set search_path = public, pg_temp
as $readiness$
begin
  if p_job_ids is null or array_length(p_job_ids, 1) is null then
    return;
  end if;

  return query
  select
    j.id,
    -- An installed or cancelled job has no readiness question left. Its parts
    -- are consumed or released, and job_schedule_conflicts returns nothing for
    -- it, which without this flag would read as a confident "ready".
    (j.status not in ('installed', 'cancelled') and j.parts_deducted_at is null),
    (j.template_id is not null),
    coalesce(t.lines, 0),
    coalesce(u.unresolved, 0),
    coalesce(c.items, 0),
    coalesce(c.units, 0)
  from public.jobs j

  -- the existing per job check, reused rather than reimplemented
  left join lateral (
    select
      count(*)::int                                as items,
      coalesce(sum(greatest(k.shortfall, 0)), 0)::int as units
    from public.job_schedule_conflicts(j.id) k
  ) c on true

  -- lines that cannot name a part yet, which conflicts skips by design
  left join lateral (
    select count(*)::int as unresolved
    from public.resolve_template_parts(j.template_id, j.faucet_finish, j.ro_type) r
    where not r.resolved
  ) u on true

  -- how many lines the sheet carries at all
  left join lateral (
    select count(*)::int as lines
    from public.template_lines tl
    where tl.template_id = j.template_id
  ) t on true

  where j.id = any(p_job_ids);
end;
$readiness$;

-- Signed in users only. The schedule is internal, and a readiness figure names
-- customers and stock levels, so anon has no business calling it.
revoke all on function public.job_schedule_readiness(uuid[]) from public, anon;
grant execute on function public.job_schedule_readiness(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- prove it, so a broken migration cannot apply quietly
--
-- The assertions below are about agreement with job_schedule_conflicts rather
-- than about any particular job being short, so they hold whatever the shelf
-- happens to look like on the day this runs.
-- ---------------------------------------------------------------------------
do $$
declare
  v_job        uuid;
  v_direct     int;
  v_via        int;
  v_unchecked  int;
begin
  -- every open job agrees with the function the modal calls
  for v_job in
    select id from public.jobs
    where status not in ('installed', 'cancelled') and parts_deducted_at is null
  loop
    select count(*)::int into v_direct from public.job_schedule_conflicts(v_job);
    select short_items into v_via from public.job_schedule_readiness(array[v_job]);

    if v_direct is distinct from v_via then
      raise exception
        'readiness disagrees with job_schedule_conflicts for job %: % against %',
        v_job, v_via, v_direct;
    end if;
  end loop;

  -- a finished job is reported as not worth checking rather than as ready
  select count(*)::int into v_unchecked
  from public.job_schedule_readiness(
    array(select id from public.jobs where status = 'installed')
  )
  where checked;

  if v_unchecked <> 0 then
    raise exception '% installed job(s) came back as still worth checking', v_unchecked;
  end if;

  -- an empty array is an empty answer, not an error
  perform public.job_schedule_readiness(array[]::uuid[]);
end $$;

notify pgrst, 'reload schema';
