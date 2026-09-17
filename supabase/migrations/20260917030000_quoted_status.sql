-- Quoted comes before sold.
--
-- A quote is a price somebody has not agreed to yet. It never promises parts,
-- never earns revenue and is never booked. It becomes sold one of two ways:
-- the customer signs the agreement the quote was sent with (agreements_sync_job
-- below, stamped with the signature time), or somebody closes it on the phone
-- and marks it sold by hand (stamped now).
--
-- Parts: sync_job_reservations already releases everything for a job with no
-- scheduled_date, so the rule that a quote has no date is the whole of "quotes
-- never promise parts". It is a constraint rather than a hope.

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs
  add constraint jobs_status_check
  check (status in ('quoted', 'sold', 'scheduled', 'installed', 'cancelled'));

alter table public.jobs
  add column if not exists sold_at          timestamptz,
  add column if not exists quote_sent_at    timestamptz,
  add column if not exists quote_sent_count integer not null default 0;

comment on column public.jobs.sold_at is
  'When the sale closed: the agreement signature for a quote, the moment it was marked sold, or created_at for a job written up as sold.';
comment on column public.jobs.quote_sent_at is 'Last time the quote was sent.';
comment on column public.jobs.quote_sent_count is 'How many times the quote has been sent.';

-- every job that exists today was written up as a sale
update public.jobs set sold_at = created_at where sold_at is null;

alter table public.jobs
  add constraint jobs_quote_has_no_date
  check (status <> 'quoted' or (scheduled_date is null and install_date is null));

-- The friendly half of that constraint, and the sold_at stamp.
create or replace function public.jobs_guard_quote()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'UPDATE' and old.status = 'quoted' and new.status in ('scheduled', 'installed') then
    raise exception 'This job is still a quote. Mark it sold, or have the customer sign, before it can be scheduled or installed.'
      using errcode = 'WB020';
  end if;

  if new.status = 'quoted' and new.scheduled_date is not null then
    raise exception 'A quote cannot have a scheduled date. Mark it sold first.'
      using errcode = 'WB020';
  end if;

  if new.status <> 'quoted' and new.status <> 'cancelled' and new.sold_at is null then
    new.sold_at := case when tg_op = 'INSERT' then coalesce(new.created_at, now()) else now() end;
  end if;

  return new;
end;
$fn$;

drop trigger if exists jobs_guard_quote on public.jobs;
create trigger jobs_guard_quote
  before insert or update on public.jobs
  for each row execute function public.jobs_guard_quote();

-- A signed customer agreement on a quote closes the sale at the signature time.
create or replace function public.agreements_sync_job()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.type = 'customer_install' then
    update public.jobs
    set agreement_status     = new.status,
        agreement_signed_url = new.signed_document_url
    where id = new.job_id;

    if new.status = 'completed' then
      update public.jobs
      set status  = 'sold',
          sold_at = coalesce(new.completed_at, now())
      where id = new.job_id
        and status = 'quoted';
    end if;
  end if;

  return new;
end;
$fn$;

-- job_margin gains the three columns at the end. Rebuilt from the live
-- definition so this file does not restate 150 lines to add three.
do $$
declare
  d text := pg_get_viewdef('public.job_margin'::regclass, true);
  n text;
begin
  n := regexp_replace(d, 'j\.is_test\s+FROM jobs j',
    'j.is_test, j.sold_at, j.quote_sent_at, j.quote_sent_count FROM jobs j');
  if n = d then
    raise exception 'job_margin did not end with is_test as expected';
  end if;
  execute 'create or replace view public.job_margin with (security_invoker = true) as ' || n;
end $$;

-- A quote owes nothing: its deposit is a term of a sale that has not happened.
do $$
declare
  d text := pg_get_viewdef('public.outstanding_balances'::regclass, true);
  n text;
begin
  n := replace(d,
    'WHEN m.status = ''cancelled''::text THEN NULL::text',
    'WHEN m.status = ''cancelled''::text THEN NULL::text WHEN m.status = ''quoted''::text THEN NULL::text');
  if n = d then
    raise exception 'outstanding_balances did not have the cancelled branch expected';
  end if;
  execute 'create or replace view public.outstanding_balances with (security_invoker = true) as ' || n;
end $$;

-- proof, or undo
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'job_margin' and column_name = 'quote_sent_count') then
    raise exception 'job_margin is missing the quote columns';
  end if;
  if exists (select 1 from public.jobs where sold_at is null and status not in ('quoted', 'cancelled')) then
    raise exception 'a sold job has no sold_at';
  end if;
end $$;
