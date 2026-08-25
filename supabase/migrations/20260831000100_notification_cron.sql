-- The daily nag on a schedule, and an hourly retry for anything that failed.
--
-- Why this goes through an edge function rather than posting from Postgres:
-- the three Slack webhook URLs are edge function secrets, and the database
-- cannot read those. Keeping it that way means exactly one process knows where
-- to post, which was the point of building this as infrastructure.
--
-- Eight in the morning Eastern, every day including weekends.
--
-- pg_cron schedules in UTC and has no timezone in its expression, and 8am
-- Eastern is 12:00 UTC in summer and 13:00 UTC in winter. Rather than picking
-- one and being an hour wrong for half the year, this fires at both and the
-- notifier checks the Eastern clock and does the work on exactly one of them.
-- Even if that check were wrong, the dedupe key is per job per day, so the
-- worst case is a second run that posts nothing.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- calling the notifier from the database
--
-- The service role key is not in this file and must not be. It lives in the
-- vault, and if it is missing this raises rather than failing quietly, because
-- a nag that silently never runs is worse than one that errors in the cron
-- log where it can be seen.
-- ---------------------------------------------------------------------------
create or replace function public.trigger_notify(p_body jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_key        text;
  v_url        text;
  v_request_id bigint;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_key is null or v_key = '' then
    raise exception
      'No service_role_key in the vault, so the scheduled notifier cannot authenticate. '
      'Add it with: select vault.create_secret(''<key>'', ''service_role_key'');'
      using errcode = 'no_data_found';
  end if;

  -- the project url is not a secret, but keeping it overridable means a branch
  -- database does not post as if it were production
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  v_url := coalesce(nullif(v_url, ''), 'https://vztoleozeqlloaadppnt.supabase.co');

  select net.http_post(
    url     := v_url || '/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := p_body,
    timeout_milliseconds := 25000
  ) into v_request_id;

  return v_request_id;
end;
$fn$;

comment on function public.trigger_notify(jsonb) is
  'Posts a body to the notify edge function using the service role key from '
  'the vault. The only bridge between the schedule and the thing that talks '
  'to Slack.';

revoke execute on function public.trigger_notify(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- the schedule
-- ---------------------------------------------------------------------------
do $$
begin
  -- unschedule first so re-running this migration is not an error
  perform cron.unschedule(jobname)
  from cron.job
  where jobname in ('notify-daily-nag', 'notify-drain');
end $$;

select cron.schedule(
  'notify-daily-nag',
  '0 12,13 * * *',
  $cron$select public.trigger_notify('{"mode":"nag"}'::jsonb)$cron$
);

-- Anything claimed but not delivered, retried. A failed row still holds its
-- dedupe key, so this is the only path by which a message whose post failed
-- ever reaches Slack, and it cannot produce a duplicate.
select cron.schedule(
  'notify-drain',
  '20 * * * *',
  $cron$select public.trigger_notify('{"mode":"drain"}'::jsonb)$cron$
);
