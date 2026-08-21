-- DocuSeal agreement automation.
--
-- Two edge functions do the outside world talking. This migration is the
-- record they read and write:
--   agreement_types  one row per kind of agreement, holding its template id
--   agreements       one row per job per type, holding the DocuSeal state
--
-- The template id is a setting rather than a constant because it changes when
-- the document is re-uploaded, and because the subcontractor flow is meant to
-- be the same mechanism pointed at a different template.

-- ---------------------------------------------------------------------------
-- jobs gains an email and two denormalised agreement columns.
--
-- DocuSeal needs somewhere to send the envelope, and jobs only carried a
-- phone number. The two agreement columns are written by a trigger, never by
-- hand, so the jobs list can show agreement state without a second query.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists customer_email text;

alter table public.jobs
  add column if not exists agreement_status text;

alter table public.jobs
  add column if not exists agreement_signed_url text;

-- ---------------------------------------------------------------------------
-- agreement_types: the managed setting.
--
-- subcontractor_service is seeded inactive on purpose. The mechanism is built
-- for it, the flow that sends one is not, and an inactive row keeps it off the
-- send menu until someone turns it on and pastes a template id.
-- ---------------------------------------------------------------------------
create table if not exists public.agreement_types (
  type                 text primary key,
  label                text not null check (btrim(label) <> ''),
  description          text,
  docuseal_template_id text,
  active               boolean not null default true,
  sort_order           int not null default 0,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users(id) default auth.uid(),
  constraint agreement_types_known check (
    type in ('customer_install', 'subcontractor_service'))
);

insert into public.agreement_types (type, label, description, active, sort_order)
values
  ('customer_install', 'Customer Install Agreement',
   'Sent to the customer on a job before the install.', true, 10),
  ('subcontractor_service', 'Subcontractor Service Agreement',
   'Sent to an installer. The sending flow is not built yet.', false, 20)
on conflict (type) do nothing;

-- ---------------------------------------------------------------------------
-- agreements: one row per job per type.
--
-- A resend updates the row in place with the new submission id rather than
-- adding a second one, so there is exactly one current answer to "where does
-- this job's customer agreement stand". The per send history lives in
-- DocuSeal, which is the system that actually owns it.
-- ---------------------------------------------------------------------------
create table if not exists public.agreements (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  job_id                 uuid not null references public.jobs(id) on delete cascade,
  type                   text not null references public.agreement_types(type)
                           on update cascade on delete restrict,
  docuseal_submission_id text,
  docuseal_slug          text,
  status                 text not null default 'pending' check (status in (
                           'pending', 'sent', 'opened', 'completed',
                           'declined', 'expired', 'failed')),
  sent_at                timestamptz,
  completed_at           timestamptz,
  signed_document_url    text,
  audit_log_url          text,
  last_error             text,
  send_count             int not null default 0,
  created_by             uuid references auth.users(id) default auth.uid(),
  unique (job_id, type)
);

create index if not exists agreements_job_idx
  on public.agreements (job_id);

create index if not exists agreements_status_idx
  on public.agreements (status);

-- the webhook finds its row by submission id, so that lookup is the one that
-- has to stay fast no matter how many agreements accumulate
create unique index if not exists agreements_submission_idx
  on public.agreements (docuseal_submission_id)
  where docuseal_submission_id is not null;

-- ---------------------------------------------------------------------------
-- agreements_touch: keep updated_at honest without the caller remembering.
-- ---------------------------------------------------------------------------
create or replace function public.agreements_touch()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $touch$
begin
  new.updated_at := now();
  return new;
end;
$touch$;

drop trigger if exists agreements_touch on public.agreements;

create trigger agreements_touch
  before update on public.agreements
  for each row execute function public.agreements_touch();

-- ---------------------------------------------------------------------------
-- agreements_sync_job: the write back the webhook is described as doing.
--
-- The webhook updates the agreement row and this puts the result on the job,
-- the same way the installer roster keeps jobs.installer in step with
-- installer_id. Doing it here rather than in the function means a status that
-- arrives by any route, including a manual correction, still lands on the job.
--
-- Only customer_install drives the job columns. A subcontractor agreement is
-- about the crew, not the customer, so it must not overwrite them.
-- ---------------------------------------------------------------------------
create or replace function public.agreements_sync_job()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $sync$
begin
  if new.type = 'customer_install' then
    update public.jobs
    set agreement_status     = new.status,
        agreement_signed_url = new.signed_document_url
    where id = new.job_id;
  end if;

  return new;
end;
$sync$;

drop trigger if exists agreements_sync_job on public.agreements;

create trigger agreements_sync_job
  after insert or update on public.agreements
  for each row execute function public.agreements_sync_job();

-- ---------------------------------------------------------------------------
-- job_margin gains the customer email and the agreement state.
--
-- appended rather than woven in, because create or replace view can add
-- columns at the end but cannot reorder or retype the ones already there.
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
  ag.id           as agreement_id,
  ag.sent_at      as agreement_sent_at,
  ag.completed_at as agreement_completed_at,
  ag.audit_log_url as agreement_audit_log_url,
  ag.last_error   as agreement_last_error,
  ag.send_count   as agreement_send_count
from public.jobs j
left join public.installers ins on ins.id = j.installer_id
left join public.installers hlp on hlp.id = j.helper_id
left join public.agreements ag
  on ag.job_id = j.id and ag.type = 'customer_install'
left join (
  select
    t.job_id,
    sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)) as parts_cost,
    sum(-t.quantity)                                   as parts_count
  from public.inventory_transactions t
  where t.job_id is not null
  group by t.job_id
) p on p.job_id = j.id;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.agreements      enable row level security;
alter table public.agreement_types enable row level security;

drop policy if exists "agreements_select" on public.agreements;
drop policy if exists "agreements_insert" on public.agreements;
drop policy if exists "agreements_update" on public.agreements;
drop policy if exists "agreements_delete" on public.agreements;

create policy "agreements_select" on public.agreements
  for select to authenticated using ((select auth.uid()) is not null);
create policy "agreements_insert" on public.agreements
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy "agreements_update" on public.agreements
  for update to authenticated using ((select auth.uid()) is not null);
create policy "agreements_delete" on public.agreements
  for delete to authenticated using ((select auth.uid()) is not null);

drop policy if exists "agreement_types_select" on public.agreement_types;
drop policy if exists "agreement_types_update" on public.agreement_types;

create policy "agreement_types_select" on public.agreement_types
  for select to authenticated using ((select auth.uid()) is not null);
create policy "agreement_types_update" on public.agreement_types
  for update to authenticated using ((select auth.uid()) is not null);

notify pgrst, 'reload schema';
