-- Carbon type, visible to the pages that open a job.
--
-- The edit drawer reads job_margin, not jobs, so a column the view does not
-- carry arrives as undefined and renders as an empty select. The field would
-- have looked present and been permanently blank, which is worse than absent:
-- an empty box reads as "no carbon type on this job" rather than as a bug.
--
-- Appended at the end of the select list, which is what create or replace view
-- allows: every existing column keeps its name, type and position. Done by
-- rewriting the stored definition rather than by restating all ninety columns,
-- so this migration cannot quietly drop one that was added in between.
do $$
declare
  v_def text := pg_get_viewdef('public.job_margin'::regclass, true);
  v_new text;
begin
  if position('j.carbon_type' in v_def) > 0 then
    raise notice 'job_margin already carries carbon_type';
    return;
  end if;

  v_new := replace(v_def,
    E'END AS profit_basis\n   FROM jobs j',
    E'END AS profit_basis,\n    j.carbon_type\n   FROM jobs j');

  if v_new = v_def then
    raise exception 'the end of the select list was not where it was expected, so nothing was changed';
  end if;

  execute 'create or replace view public.job_margin as ' || v_new;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'job_margin' and column_name = 'carbon_type'
  ) then
    raise exception 'job_margin still does not carry carbon_type';
  end if;

  -- and it carries the value, not just the column
  if exists (
    select 1
    from public.jobs j
    join public.job_margin m on m.id = j.id
    where m.carbon_type is distinct from j.carbon_type
  ) then
    raise exception 'job_margin disagrees with jobs about carbon type';
  end if;

  raise notice 'job_margin carries carbon type, and agrees with the job';
end $$;
