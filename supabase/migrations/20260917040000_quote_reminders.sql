-- Quotes due a morning reminder: sent, unsigned, and exactly 2, 5 or 10 days
-- old today in Eastern time. Three nudges and then silence, because a daily
-- message about the same cold quote is one people learn to scroll past. Past
-- ten days it is the Needs attention list's problem, not Slack's.

create or replace view public.quote_nag_candidates
with (security_invoker = true)
as
with today as (
  select (now() at time zone 'America/New_York')::date as d
)
select
  j.id                                                              as job_id,
  j.customer_name,
  j.system_template,
  j.sale_price,
  j.quote_sent_at,
  j.quote_sent_count,
  t.d - (j.quote_sent_at at time zone 'America/New_York')::date     as days_since_sent,
  ca.view_count                                                     as agreement_view_count
from public.jobs j
cross join today t
left join public.agreements ca
  on ca.job_id = j.id and ca.type = 'customer_install'
where j.status = 'quoted'
  and not j.is_test
  and j.quote_sent_at is not null
  and (j.nag_snoozed_until is null or j.nag_snoozed_until <= t.d)
  and ca.status is distinct from 'completed'
  and t.d - (j.quote_sent_at at time zone 'America/New_York')::date in (2, 5, 10);

comment on view public.quote_nag_candidates is
  'Sent, unsigned quotes that are 2, 5 or 10 days old today (Eastern). Read by the notify morning sweep.';
