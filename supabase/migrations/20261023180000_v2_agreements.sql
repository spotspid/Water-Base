-- Documents sent against a v2 job.
--
-- Same shape as the live table, because the same DocuSeal account sends them
-- and the same webhook events come back. Copied rather than shared: v2 may
-- not reference public, and at cutover this schema is renamed over it, so a
-- row written here has to make sense under the old name without being moved.
--
-- Not copied: created_by, which pointed at a user and was never read, and
-- docuseal_slug, which was stored and never used either.

create table if not exists v2.agreements (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references v2.organizations (id) on delete cascade,
  job_id               uuid not null references v2.jobs (id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- customer_install or subcontractor_service, the two the field map knows.
  type                 text not null,

  docuseal_submission_id text,
  status               text not null default 'pending',
  sent_at              timestamptz,
  completed_at         timestamptz,
  signed_document_url  text,
  audit_log_url        text,
  last_error           text,
  send_count           integer not null default 0,
  view_count           integer not null default 0,

  constraint agreements_type_known check (type in ('customer_install', 'subcontractor_service')),
  constraint agreements_status_known check (status in (
    'pending', 'sent', 'opened', 'completed', 'declined', 'expired', 'failed'))
);

-- One live document of each kind per job. A resend replaces the submission id
-- on the same row rather than leaving two rows claiming to be the agreement.
create unique index if not exists agreements_job_type_key
  on v2.agreements (job_id, type);

-- The webhook finds a row by what DocuSeal sends back, so this has to be fast
-- and unique across the table.
create unique index if not exists agreements_submission_key
  on v2.agreements (docuseal_submission_id)
  where docuseal_submission_id is not null;

create index if not exists agreements_org_status_idx on v2.agreements (org_id, status);

drop trigger if exists agreements_touch_updated_at on v2.agreements;

create trigger agreements_touch_updated_at
before update on v2.agreements
for each row execute function v2.touch_updated_at();

-- A signed customer agreement moves the job to sold, which is what the live
-- schema does through its own trigger. Written here so a quote that comes back
-- signed does not sit as a quote until somebody notices.
create or replace function v2.agreements_sync_job()
returns trigger
language plpgsql
set search_path to 'v2', 'pg_temp'
as $function$
begin
  if new.type <> 'customer_install' then
    return new;
  end if;

  if new.status = 'completed' then
    update v2.jobs
    set status = 'sold'
    where id = new.job_id and status = 'quoted';
  end if;

  return new;
end;
$function$;

drop trigger if exists agreements_sync_job on v2.agreements;

create trigger agreements_sync_job
after insert or update of status on v2.agreements
for each row execute function v2.agreements_sync_job();

alter table v2.agreements enable row level security;

drop policy if exists agreements_select on v2.agreements;
drop policy if exists agreements_insert on v2.agreements;
drop policy if exists agreements_update on v2.agreements;
drop policy if exists agreements_delete on v2.agreements;

create policy agreements_select on v2.agreements
  for select to authenticated using (org_id in (select v2.my_orgs()));
create policy agreements_insert on v2.agreements
  for insert to authenticated with check (org_id in (select v2.my_orgs()));
create policy agreements_update on v2.agreements
  for update to authenticated using (org_id in (select v2.my_orgs()));
create policy agreements_delete on v2.agreements
  for delete to authenticated using (org_id in (select v2.my_orgs()));

grant select, insert, update, delete on v2.agreements to authenticated;

notify pgrst, 'reload schema';

do $$
declare
  v_org uuid;
  v_job uuid;
  v_one uuid;
begin
  select id into v_org from v2.organizations where lower(name) = 'michigan water pros';

  insert into v2.jobs (org_id, customer_name, status) values (v_org, 'ZZ Agreement Probe', 'quoted')
  returning id into v_job;

  insert into v2.agreements (org_id, job_id, type, docuseal_submission_id, status)
  values (v_org, v_job, 'customer_install', 'probe-1', 'sent')
  returning id into v_one;

  -- 1. one live document of each kind per job
  begin
    insert into v2.agreements (org_id, job_id, type, docuseal_submission_id)
    values (v_org, v_job, 'customer_install', 'probe-2');

    raise exception 'A job was allowed two customer agreements.';
  exception
    when unique_violation then null;
  end;

  -- and the other kind is fine on the same job
  insert into v2.agreements (org_id, job_id, type, docuseal_submission_id)
  values (v_org, v_job, 'subcontractor_service', 'probe-3');

  -- 2. a signed customer agreement sells the job
  update v2.agreements set status = 'completed' where id = v_one;

  if (select status from v2.jobs where id = v_job) <> 'sold' then
    raise exception 'A signed agreement did not move the quote to sold.';
  end if;

  -- 3. and does not drag a job backwards from further along
  update v2.jobs set status = 'installed' where id = v_job;
  update v2.agreements set status = 'completed' where id = v_one;

  if (select status from v2.jobs where id = v_job) <> 'installed' then
    raise exception 'A signed agreement pulled an installed job back to sold.';
  end if;

  delete from v2.jobs where id = v_job;

  raise notice 'one document of each kind per job, and a signature sells the quote';
end $$;
