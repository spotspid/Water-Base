-- An installed job carries the date it was installed.
--
-- mark_job_installed always writes one, falling back to today, so nothing
-- that goes through the app can arrive here without it. The row that
-- prompted this was written by hand in SQL: Walter Radu was entered after
-- the fact, ledger rows and all, with parts_deducted_at set to the same
-- second as created_at. That row did carry an install date, and the app was
-- reading the booking date instead, which has since been fixed on the job
-- modal. This closes the gap for the next hand written row, which might not.
--
-- Extends the existing guard rather than adding a check constraint, so the
-- message says which function to use rather than naming a constraint.
create or replace function public.jobs_guard_install_status()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.status = 'installed' and new.parts_deducted_at is null then
    raise exception 'A job becomes installed through mark_job_installed() so its parts are deducted from inventory.'
      using errcode = 'WB007';
  end if;

  if new.status = 'installed' and new.install_date is null then
    raise exception 'An installed job needs an install date. mark_job_installed() sets one, so use it rather than updating the row.'
      using errcode = 'WB007';
  end if;

  if new.status <> 'installed' and new.parts_deducted_at is not null then
    raise exception 'A job leaves installed through revert_job_install() so its parts are returned to inventory.'
      using errcode = 'WB008';
  end if;

  return new;
end;
$$;
