-- Notifications, as infrastructure rather than as Slack calls in the code.
--
-- The rule is that nothing reaches Slack without a row here first. The row is
-- claimed before the post, not written after it, so the unique dedupe key is
-- the lock rather than a record of what already happened. Two workers racing
-- on the same event means one insert wins and the other is told to stand down.
--
-- That is what makes retries and the daily sweep safe. A DocuSeal retry
-- carries the same submission id, so it computes the same key and is dropped.
-- The daily nag keys on the job and the calendar day, so running the cron
-- twice, or by hand while testing, still posts once per job per day.
--
-- Channels are named, not URLs. Which webhook a channel resolves to is an edge
-- function secret, so this table can be read by anyone who can read jobs
-- without exposing anywhere to post.

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  event_type   text not null,
  job_id       uuid references public.jobs(id) on delete cascade,
  channel      text not null check (channel in ('new_sale', 'scheduling', 'stock')),
  message      text not null,

  -- what stops a retry posting twice. Unique, and claimed before the send.
  dedupe_key   text not null unique,

  status       text not null default 'pending'
                 check (status in ('pending', 'sent', 'failed')),
  sent_at      timestamptz,
  attempts     int not null default 0,
  last_error   text,

  -- whatever the sender wants to keep: the day counts on a nag, the submission
  -- id on a signature, the length of a snooze
  payload      jsonb
);

comment on table public.notifications is
  'Every Slack post, logged before it is sent. The dedupe key is claimed first '
  'and is unique, so a retry or a second cron run finds the key taken and '
  'sends nothing.';

comment on column public.notifications.dedupe_key is
  'What makes a send idempotent. Signatures key on the agreement so they fire '
  'once ever; nags key on the job and the day so they fire once a day.';

create index if not exists notifications_job_idx
  on public.notifications (job_id, created_at desc);

create index if not exists notifications_pending_idx
  on public.notifications (status, created_at) where status <> 'sent';

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using ((select auth.uid()) is not null);

-- Rows are written by the edge functions under the service role, which bypasses
-- row level security. There is deliberately no insert or update policy for
-- authenticated: a row means a send was claimed, and letting the UI write one
-- directly would make the log lie.

-- ---------------------------------------------------------------------------
-- how many times a document has been opened
--
-- Kept on the agreement rather than the job, because a job carries two
-- documents and "the customer opened it four times" is a different fact from
-- "the installer opened the work order four times". The job record shows both,
-- through job_margin below.
-- ---------------------------------------------------------------------------
alter table public.agreements
  add column if not exists view_count int not null default 0;

comment on column public.agreements.view_count is
  'form.viewed events counted. Four views and no signature is a phone call, '
  'which is why this is on the record and not only in Slack.';

-- ---------------------------------------------------------------------------
-- per job snooze
--
-- Silences one job without silencing the rule. Exclusive: a job snoozed until
-- the 3rd nags again on the 3rd.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists nag_snoozed_until date;

comment on column public.jobs.nag_snoozed_until is
  'Chasing signatures on this job is paused until this date. Set through '
  'snooze_job_nag, which also writes the notifications row that says so.';

-- ---------------------------------------------------------------------------
-- claim a send
--
-- Returns the new row id when this caller won the key, and null when someone
-- already holds it. The caller posts only on a non null answer, so the insert
-- is the permission to send rather than a note that a send happened.
-- ---------------------------------------------------------------------------
create or replace function public.claim_notification(
  p_event_type text,
  p_channel    text,
  p_message    text,
  p_dedupe_key text,
  p_job_id     uuid default null,
  p_payload    jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id uuid;
begin
  insert into public.notifications (event_type, channel, message, dedupe_key, job_id, payload)
  values (p_event_type, p_channel, p_message, p_dedupe_key, p_job_id, p_payload)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  -- null means the key was already taken, which is a duplicate rather than a
  -- failure. The caller sends nothing and says so.
  return v_id;
end;
$fn$;

create or replace function public.mark_notification_sent(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $fn$
  update public.notifications
  set status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = null
  where id = p_id;
$fn$;

create or replace function public.mark_notification_failed(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $fn$
  update public.notifications
  set status = 'failed', attempts = attempts + 1, last_error = left(p_error, 500)
  where id = p_id;
$fn$;

revoke execute on function public.claim_notification(text, text, text, text, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.mark_notification_sent(uuid)
  from public, anon, authenticated;
revoke execute on function public.mark_notification_failed(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- count a view
--
-- Separate from the status update, because form.viewed arrives every time the
-- customer opens the link and the status only moves the first time.
-- ---------------------------------------------------------------------------
create or replace function public.count_agreement_view(p_agreement_id uuid)
returns int
language sql
security definer
set search_path = public, pg_temp
as $fn$
  update public.agreements
  set view_count = view_count + 1
  where id = p_agreement_id
  returning view_count;
$fn$;

revoke execute on function public.count_agreement_view(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- who is due a nag
--
-- The rule, as data, so it can be read and argued with in SQL rather than
-- being buried in a function that has to be deployed to be inspected.
--
--   a scheduled date inside the next 14 days
--   the customer agreement or the work order not signed
--   not snoozed
--
-- A missing agreements row counts as unsigned, because nobody having sent the
-- document at all is the case most worth chasing. Cancelled jobs are out:
-- there is no install left to chase a signature for.
--
-- Both day counts are carried. Days until the install is the urgency, days
-- unsigned is the story, and two days out unsigned for nine reads nothing like
-- fourteen days out unsigned for one.
-- ---------------------------------------------------------------------------
create or replace view public.nag_candidates
with (security_invoker = true) as
with today as (
  select (now() at time zone 'America/New_York')::date as d
)
select
  j.id                                   as job_id,
  j.customer_name,
  j.system_template,
  j.scheduled_date,
  (j.scheduled_date - t.d)::int          as days_until_install,
  j.nag_snoozed_until,

  ca.status                              as agreement_status,
  (ca.status is distinct from 'completed') as agreement_unsigned,
  case when ca.sent_at is null then null
       else (t.d - (ca.sent_at at time zone 'America/New_York')::date)::int end
                                         as agreement_days_unsigned,
  coalesce(ca.view_count, 0)::int        as agreement_view_count,

  wo.status                              as work_order_status,
  (wo.status is distinct from 'completed') as work_order_unsigned,
  case when wo.sent_at is null then null
       else (t.d - (wo.sent_at at time zone 'America/New_York')::date)::int end
                                         as work_order_days_unsigned,

  ins.name                               as installer_name
from public.jobs j
cross join today t
left join public.agreements ca on ca.job_id = j.id and ca.type = 'customer_install'
left join public.agreements wo on wo.job_id = j.id and wo.type = 'subcontractor_service'
left join public.installers ins on ins.id = j.installer_id
where j.scheduled_date is not null
  and j.scheduled_date >= t.d
  and j.scheduled_date <= t.d + 14
  and j.status <> 'cancelled'
  and (j.nag_snoozed_until is null or j.nag_snoozed_until <= t.d)
  and (ca.status is distinct from 'completed' or wo.status is distinct from 'completed');

comment on view public.nag_candidates is
  'Jobs the daily sweep would post about right now. Reading this is the same '
  'as asking what 8am would say.';

grant select on public.nag_candidates to authenticated;

-- ---------------------------------------------------------------------------
-- pause one job
--
-- An action on the job record, and logged, because a job that goes quiet with
-- no record of why is how a job gets forgotten. The row goes to the scheduling
-- channel so the pause is visible to whoever else is watching it.
-- ---------------------------------------------------------------------------
create or replace function public.snooze_job_nag(p_job_id uuid, p_days int)
returns date
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_until date;
  v_name  text;
begin
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

  -- Keyed on the job and the moment, so pausing twice in one day records both
  -- rather than silently dropping the second.
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
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_name text;
begin
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

grant execute on function public.snooze_job_nag(uuid, int) to authenticated;
grant execute on function public.resume_job_nag(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- job_margin carries the view counts and the snooze, so the job record reads
-- them off the row it already fetches.
-- ---------------------------------------------------------------------------
create or replace view public.job_margin
with (security_invoker = true) as
select
  j.id,
  j.created_at,
  j.customer_name,
  j.city,
  j.system_template,
  j.template_id,
  j.status,
  j.install_date,
  j.installer,
  j.invoice_number,
  j.faucet_finish,
  j.parts_deducted_at,
  j.parts_deduct_batch,
  j.sale_price,
  coalesce(j.payout_amount, 0)::numeric(10,2) as installer_pay,
  coalesce(p.parts_cost, 0)::numeric(10,2)    as parts_cost,
  coalesce(p.parts_count, 0)::int             as parts_count,
  (j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0))::numeric(10,2) as margin,
  case
    when j.sale_price is null or j.sale_price = 0 then null
    else round(
      (j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0)) * 100.0 / j.sale_price,
      1)
  end as margin_pct,
  j.address,
  j.phone,
  j.scheduled_date,
  j.time_window,
  j.installer_id,
  ins.name  as installer_name,
  j.helper_id,
  hlp.name  as helper_name,
  j.customer_email,
  j.agreement_status,
  j.agreement_signed_url,
  ag.id            as agreement_id,
  ag.sent_at       as agreement_sent_at,
  ag.completed_at  as agreement_completed_at,
  ag.audit_log_url as agreement_audit_log_url,
  ag.last_error    as agreement_last_error,
  ag.send_count    as agreement_send_count,
  j.ro_type,
  wo.id                  as work_order_id,
  wo.status              as work_order_status,
  wo.sent_at             as work_order_sent_at,
  wo.completed_at        as work_order_completed_at,
  wo.signed_document_url as work_order_signed_url,
  wo.audit_log_url       as work_order_audit_log_url,
  wo.last_error          as work_order_last_error,
  wo.send_count          as work_order_send_count,
  ins.email              as installer_email,
  j.site_conditions,
  -- notifications
  coalesce(ag.view_count, 0)::int as agreement_view_count,
  coalesce(wo.view_count, 0)::int as work_order_view_count,
  j.nag_snoozed_until
from public.jobs j
left join public.installers ins on ins.id = j.installer_id
left join public.installers hlp on hlp.id = j.helper_id
left join public.agreements ag
  on ag.job_id = j.id and ag.type = 'customer_install'
left join public.agreements wo
  on wo.job_id = j.id and wo.type = 'subcontractor_service'
left join (
  select
    t.job_id,
    sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)) as parts_cost,
    sum(-t.quantity)                                   as parts_count
  from public.inventory_transactions t
  where t.job_id is not null
  group by t.job_id
) p on p.job_id = j.id;

notify pgrst, 'reload schema';
