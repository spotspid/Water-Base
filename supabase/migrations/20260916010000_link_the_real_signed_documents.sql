-- ---------------------------------------------------------------------------
-- The real signed documents, linked to the jobs they belong to.
--
-- Eight customer agreements were back loaded as completed with a noon
-- timestamp and no submission, because they were built by hand in DocuSeal
-- before the templates existed and nobody had looked them up. They exist, and
-- this points each job at its own.
--
-- What is stored is the submission id and the times DocuSeal recorded. The
-- file URLs are not: DocuSeal signs them with an expiry about forty minutes
-- out, so a stored one is a dead link by the next day. A link is fetched fresh
-- from the submission id when one is wanted.
--
-- completed_at is the submission's completed_at, the moment the last party
-- signed, which is the moment DocuSeal calls the document done and the moment
-- the webhook would have written had these gone through the app.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- agreement_history: signed documents a job keeps but does not point at.
--
-- agreements holds one current document per job per type, and that stays
-- true. A job can still have more than one real signed document of a type: a
-- work order redone for a new date, or one signed by an installer who did not
-- finish the job. Those are part of the record and are kept here, with a note
-- saying why they are not the current one, rather than being lost.
-- ---------------------------------------------------------------------------
create table if not exists public.agreement_history (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  job_id                 uuid not null references public.jobs(id) on delete cascade,
  type                   text not null references public.agreement_types(type)
                           on update cascade on delete restrict,
  docuseal_submission_id text not null,
  status                 text not null check (status in (
                           'pending', 'sent', 'opened', 'completed',
                           'declined', 'expired', 'failed')),
  sent_at                timestamptz,
  completed_at           timestamptz,
  signed_by              text,
  note                   text not null check (btrim(note) <> ''),
  constraint agreement_history_submission_key unique (docuseal_submission_id)
);

comment on table public.agreement_history is
  'Signed documents a job keeps but does not point at: superseded work orders, '
  'and ones signed by an installer who did not finish. The current document '
  'per job and type stays in agreements.';

create index if not exists agreement_history_job_idx
  on public.agreement_history (job_id);

alter table public.agreement_history enable row level security;

drop policy if exists "agreement_history_select" on public.agreement_history;

-- Read only to the app. A row here is a claim about what was signed, so it is
-- written by a migration or the service role, never typed in from the UI.
create policy "agreement_history_select" on public.agreement_history
  for select to authenticated using ((select auth.uid()) is not null);

-- ---------------------------------------------------------------------------
-- link one agreement, refusing to carry on if it does not land on exactly one
-- row. A silent zero here would leave an invented date in place and report
-- success.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.link_signed(
  p_job_id        uuid,
  p_type          text,
  p_submission_id text,
  p_sent_at       timestamptz,
  p_completed_at  timestamptz
)
returns void
language plpgsql
as $link$
declare
  v_rows int;
begin
  -- The row may not exist yet, for a work order nobody sent through the app.
  insert into public.agreements (job_id, type, status, send_count)
  values (p_job_id, p_type, 'pending', 0)
  on conflict (job_id, type) do nothing;

  update public.agreements
  set docuseal_submission_id = p_submission_id,
      docuseal_slug          = null,
      status                 = 'completed',
      sent_at                = p_sent_at,
      completed_at           = p_completed_at,
      signed_document_url    = null,
      audit_log_url          = null,
      last_error             = null,
      -- sent by hand in DocuSeal, not through the app, and the views counted on
      -- a replaced row were views of a different document
      send_count             = 0,
      view_count             = 0
  where job_id = p_job_id
    and type   = p_type;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Linking submission % to job % (%) touched % rows, expected 1.',
      p_submission_id, p_job_id, p_type, v_rows;
  end if;
end;
$link$;

-- ---------------------------------------------------------------------------
-- the eight customer agreements
-- ---------------------------------------------------------------------------
select pg_temp.link_signed('006bdd7c-81ae-4fea-bb2a-7cb00efb5571', 'customer_install', '9659447',
  '2026-07-25T22:20:09.458Z', '2026-07-25T22:34:17.541Z');  -- David Camaj
select pg_temp.link_signed('29b59b34-5aa4-4b15-958f-7b6b27947a0e', 'customer_install', '10054143',
  '2026-08-09T00:33:53.265Z', '2026-08-11T19:37:08.103Z');  -- Ashley Fox
select pg_temp.link_signed('a8da94cd-ae94-433d-ae8e-eec2c6657a89', 'customer_install', '10219345',
  '2026-08-14T19:03:51.767Z', '2026-08-14T19:06:34.277Z');  -- Walter Radu
select pg_temp.link_signed('c6674e5f-bf1a-424c-9ce2-ca574b3d50a7', 'customer_install', '10251690',
  '2026-08-16T16:23:01.664Z', '2026-08-16T16:59:42.958Z');  -- April Y. Stone
select pg_temp.link_signed('05683c8c-bd82-4832-af77-65af3c4cce95', 'customer_install', '10275776',
  '2026-08-17T17:10:14.413Z', '2026-08-17T18:58:29.633Z');  -- Neil Toomey
select pg_temp.link_signed('a0907e7f-cfe0-4473-84af-9fa0a9ddb6fe', 'customer_install', '10285048',
  '2026-08-17T20:24:55.629Z', '2026-08-17T20:27:01.787Z');  -- John Augustin
select pg_temp.link_signed('27099a05-49e3-4110-b920-fe57fd782fcd', 'customer_install', '10022757',
  '2026-08-07T15:35:49.331Z', '2026-08-19T12:57:41.757Z');  -- Prudhvi Yalavarthi
select pg_temp.link_signed('18d70224-bc7f-4b98-ba13-f9e6fe6522a6', 'customer_install', '9874242',
  '2026-08-03T13:04:55.345Z', '2026-08-19T20:47:42.533Z');  -- Itohan Faith Obasuyi

-- ---------------------------------------------------------------------------
-- the work orders
--
-- Neil's row pointed at 11070450, a test send to ZZ Test Installer that was
-- archived in DocuSeal. It is replaced, not kept: it was never a document
-- about his job.
-- ---------------------------------------------------------------------------
select pg_temp.link_signed('05683c8c-bd82-4832-af77-65af3c4cce95', 'subcontractor_service', '10918971',
  '2026-09-06T21:41:35.673Z', '2026-09-09T19:43:19.807Z');  -- Neil Toomey
select pg_temp.link_signed('a0907e7f-cfe0-4473-84af-9fa0a9ddb6fe', 'subcontractor_service', '10918985',
  '2026-09-06T21:43:06.287Z', '2026-09-09T19:43:28.809Z');  -- John Augustin
select pg_temp.link_signed('27099a05-49e3-4110-b920-fe57fd782fcd', 'subcontractor_service', '11063635',
  '2026-09-10T18:46:50.075Z', '2026-09-11T20:02:34.758Z');  -- Prudhvi Yalavarthi, for 9/13
select pg_temp.link_signed('a8da94cd-ae94-433d-ae8e-eec2c6657a89', 'subcontractor_service', '10374165',
  '2026-08-20T13:08:44.422Z', '2026-08-21T16:00:03.819Z');  -- Walter Radu, Jay Woodward

-- ---------------------------------------------------------------------------
-- the signed work orders kept rather than linked
-- ---------------------------------------------------------------------------
insert into public.agreement_history
  (job_id, type, docuseal_submission_id, status, sent_at, completed_at, signed_by, note)
values
  ('27099a05-49e3-4110-b920-fe57fd782fcd', 'subcontractor_service', '10801139', 'completed',
   '2026-09-02T19:55:51.795Z', '2026-09-02T23:38:55.625Z', 'jay.awoodward@gmail.com',
   'First work order, for the original install date. Superseded by the revised one '
   || 'the next day, then by 11063635 when the job moved to 9/13.'),
  ('27099a05-49e3-4110-b920-fe57fd782fcd', 'subcontractor_service', '10826754', 'completed',
   '2026-09-03T14:55:24.742Z', '2026-09-03T20:06:39.275Z', 'jay.awoodward@gmail.com',
   'Revised work order for the original install date. Superseded by 11063635 when the '
   || 'job moved to 9/13.'),
  ('a8da94cd-ae94-433d-ae8e-eec2c6657a89', 'subcontractor_service', '10238455', 'completed',
   '2026-08-15T16:54:00.315Z', '2026-08-16T16:04:19.185Z', 'tthomaspropertymanagement@gmail.com',
   'Anthony Thomas attempted the install on Aug 16 and was let go. Jay Woodward completed '
   || 'it on Aug 21 under 10374165, which is the record of the work.')
on conflict (docuseal_submission_id) do nothing;

-- ---------------------------------------------------------------------------
-- Walter Radu: Jay Woodward did the work
--
-- jobs_sync_installer_name rewrites the installer text from the roster. The
-- job is installed and deducted, and neither the status nor anything the
-- reservations watch changes, so no stock moves.
-- ---------------------------------------------------------------------------
do $walter$
declare
  v_jay  uuid;
  v_rows int;
begin
  select id into v_jay
  from public.installers
  where lower(btrim(email)) = 'jay.awoodward@gmail.com';

  if v_jay is null then
    raise exception 'Jay Woodward is not on the installer roster, so Walter Radu''s job cannot be moved to him.';
  end if;

  update public.jobs
  set installer_id = v_jay,
      notes = btrim(coalesce(notes, '') || ' Installer corrected 2026-09-16: Anthony Thomas '
        || 'attempted the install on Aug 16 and was let go; Jay Woodward completed it on Aug 21. '
        || 'Both signed work orders are kept on the job.')
  where id = 'a8da94cd-ae94-433d-ae8e-eec2c6657a89';

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Moving Walter Radu''s job to Jay Woodward touched % rows, expected 1.', v_rows;
  end if;
end;
$walter$;
