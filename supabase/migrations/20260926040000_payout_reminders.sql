-- Booked work with nobody's pay written on it.
--
-- The morning sweep already chases unsigned paperwork on the same jobs. This
-- is the other thing that has to be true before a crew turns up: what they
-- are being paid. Left blank it is not a payout of nothing, it is a blank, and
-- since 20260926020000 every screen says so by refusing to show a profit for
-- the job at all. A job can therefore sit in the calendar all fortnight with
-- no profit figure and nobody looking at the one field that would give it one.
--
-- Same shape as nag_candidates, deliberately: the same fourteen day window,
-- the same snooze column, the same exclusion of cancelled and test jobs. A job
-- with a date and no pay is nagged every morning until somebody types a
-- figure, and pausing the job quietens both lists at once, because there is
-- one pause per job and one thing being asked: get this job ready.
--
-- What counts as no pay is the rule the Needs attention list already uses:
-- null or zero or less. A payout of exactly zero on booked work has always
-- been somebody who never filled it in rather than a crew working for free,
-- and two definitions of "pay not set" across two screens is the fault this
-- app has too much of already.

create or replace view public.payout_nag_candidates
with (security_invoker = true)
as
with today as (
  select (now() at time zone 'America/New_York')::date as d
)
select
  j.id                        as job_id,
  j.customer_name,
  j.system_template,
  j.scheduled_date,
  j.scheduled_date - t.d      as days_until_install,
  j.sale_price,
  j.payout_amount,
  j.nag_snoozed_until,
  j.installer_id,
  ins.name                    as installer_name
from public.jobs j
cross join today t
left join public.installers ins on ins.id = j.installer_id
where j.scheduled_date is not null
  and j.scheduled_date >= t.d
  and j.scheduled_date <= t.d + 14
  and j.status <> 'cancelled'
  and not j.is_test
  and (j.nag_snoozed_until is null or j.nag_snoozed_until <= t.d)
  and (j.payout_amount is null or j.payout_amount <= 0);

comment on view public.payout_nag_candidates is
  'Jobs booked within 14 days with no installer payout recorded, null or zero. '
  'Read by the notify morning sweep, alongside nag_candidates.';

do $$
declare
  v_leaked int;
begin
  -- The three exclusions that make a reminder list usable. If any of these
  -- ever returns a row, somebody is being asked every morning about a job
  -- they deliberately silenced, cancelled, or made up.
  select count(*) into v_leaked
  from public.payout_nag_candidates c
  join public.jobs j on j.id = c.job_id
  where j.is_test
     or j.status = 'cancelled'
     or (j.nag_snoozed_until is not null
         and j.nag_snoozed_until > (now() at time zone 'America/New_York')::date);
  if v_leaked > 0 then
    raise exception '% jobs that should be quiet are in the payout reminders', v_leaked;
  end if;

  -- And the point of the list: everything on it is missing its pay.
  select count(*) into v_leaked
  from public.payout_nag_candidates
  where payout_amount is not null and payout_amount > 0;
  if v_leaked > 0 then
    raise exception '% jobs with a payout are in the payout reminders', v_leaked;
  end if;
end $$;

notify pgrst, 'reload schema';
