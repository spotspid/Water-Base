-- The sales checklist on a v2 job.
--
-- The questions somebody asks at the kitchen table so the install does not
-- turn into a second visit: how many people use the water, where the shutoff
-- is, whether there is room, whether there is a receptacle in reach, what the
-- main line is made of, whether there are irrigation lines, whether the old
-- equipment is going.
--
-- Carried over from the live schema unchanged, including the shape, so
-- src/lib/salesChecklist.js works against both without a second version of
-- the rules. That file is pure: no database client, no framework, just the
-- questions and what counts as an answer.
--
-- One blob rather than ten columns. The questions are a water business's
-- questions, and the next dealer will want an eleventh. A column per question
-- makes that a migration; a blob makes it a setting, later, without moving
-- anybody's data.
--
-- Answered and Not sure yet are different, and both are different from
-- unanswered. Not sure yet means the question was asked and nobody in the
-- house knew, which is a real answer for quoting and not one for installing.

alter table v2.jobs
  add column if not exists sales_checklist jsonb not null default '{}'::jsonb;

comment on column v2.jobs.sales_checklist is
  'The kitchen table questions. Shape matches src/lib/salesChecklist.js so one '
  'set of rules serves both schemas.';

-- people_in_home and bathrooms were added as their own columns before the
-- checklist came over, and the checklist asks for them too. The columns stay
-- as the answer, because a number that decides which system to quote should
-- not be buried in a blob, and the checklist reads them from there.

notify pgrst, 'reload schema';

do $$
declare
  v_org uuid;
  v_job uuid;
  v_got jsonb;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'v2' and table_name = 'jobs' and column_name = 'sales_checklist') then
    raise exception 'v2.jobs has no sales_checklist column.';
  end if;

  select id into v_org from v2.organizations where lower(name) = 'michigan water pros';

  -- A job saves with no checklist at all, because a quote often happens on the
  -- phone before anybody has walked the house.
  insert into v2.jobs (org_id, customer_name) values (v_org, 'ZZ Checklist Probe')
  returning id into v_job;

  select sales_checklist into v_got from v2.jobs where id = v_job;

  if v_got is null then
    raise exception 'A job with no checklist stored null rather than an empty answer set.';
  end if;

  -- And it holds what it is given, including a Not sure yet, which has to
  -- survive as its own value rather than collapsing to blank.
  update v2.jobs
  set sales_checklist = '{"shutoff_location": "not_sure", "receptacle_within_6ft": "yes"}'::jsonb
  where id = v_job;

  select sales_checklist into v_got from v2.jobs where id = v_job;

  if v_got->>'shutoff_location' <> 'not_sure' then
    raise exception 'Not sure yet did not survive being stored.';
  end if;

  delete from v2.jobs where id = v_job;

  raise notice 'the checklist stores, and Not sure yet is kept apart from blank';
end $$;
