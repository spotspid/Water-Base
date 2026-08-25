-- snooze_job_nag and resume_job_nag write the row that records the pause, and
-- notifications deliberately has no insert policy for authenticated, so as
-- security invoker they were blocked by the very rule that keeps the log
-- honest: a row exists only because a send was claimed, never because the UI
-- asked for one.
--
-- They become security definer, with an explicit signed in check standing in
-- for the row level policy they are now bypassing. The alternative, granting
-- authenticated a direct insert on notifications, would have made the log
-- something the browser could write into, which is the thing worth avoiding.

create or replace function public.snooze_job_nag(p_job_id uuid, p_days int)
returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_until date;
  v_name  text;
begin
  -- security definer bypasses row level security, so the check the policy was
  -- making has to be made here instead
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  if p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'Pause length must be between 1 and 60 days, not %', p_days
      using errcode = 'check_violation';
  end if;

  select customer_name into v_name from public.jobs where id = p_job_id;

  if not found then
    raise exception 'That job does not exist, or you cannot see it.'
      using errcode = 'no_data_found';
  end if;

  v_until := (now() at time zone 'America/New_York')::date + p_days;

  update public.jobs set nag_snoozed_until = v_until where id = p_job_id;

  insert into public.notifications (event_type, channel, message, dedupe_key, job_id, payload)
  values (
    'nag.snoozed',
    'scheduling',
    format('Reminders paused on %s until %s.',
           coalesce(v_name, 'a job'),
           to_char(v_until, 'FMMon FMDD')),
    format('nag.snoozed:%s:%s', p_job_id, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    p_job_id,
    jsonb_build_object('days', p_days, 'until', v_until)
  );

  return v_until;
end;
$fn$;

create or replace function public.resume_job_nag(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  select customer_name into v_name from public.jobs where id = p_job_id;

  if not found then
    raise exception 'That job does not exist, or you cannot see it.'
      using errcode = 'no_data_found';
  end if;

  update public.jobs set nag_snoozed_until = null where id = p_job_id;

  insert into public.notifications (event_type, channel, message, dedupe_key, job_id, payload)
  values (
    'nag.resumed',
    'scheduling',
    format('Reminders back on for %s.', coalesce(v_name, 'a job')),
    format('nag.resumed:%s:%s', p_job_id, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    p_job_id,
    null
  );
end;
$fn$;

revoke execute on function public.snooze_job_nag(uuid, int) from public, anon;
revoke execute on function public.resume_job_nag(uuid) from public, anon;
grant execute on function public.snooze_job_nag(uuid, int) to authenticated;
grant execute on function public.resume_job_nag(uuid) to authenticated;
