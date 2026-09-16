-- ---------------------------------------------------------------------------
-- Every job has an invoice number, and a new one gets the next automatically.
--
-- Ten jobs had none. A job with no invoice number cannot send its work order,
-- stamps nothing on the ledger rows it deducts, and sat on the Needs attention
-- list. The new job form made one up to the typist, so numbers were skipped,
-- spaced differently (MWP-0001 and MWP 005) or left out.
--
-- The format is MWP-####. The highest existing number is taken from invoice
-- numbers of the form MWP-0001 or MWP 005, which today is 5 (Neil Toomey's
-- MWP 005). MWP-TEST-09 is the test job's and is not a number in the sequence.
-- Existing numbers are left exactly as they are.
--
-- Jobs without one are numbered from MWP-0006 in order of creation, then by
-- customer name where several were created in the same instant, so the order
-- is the same however often it is read.
--
-- From here:
--   insert   a blank invoice number is filled with the next one, so the new
--            job form no longer has to ask for it. A number typed in is kept.
--   update   clearing it is refused with a sentence, because a blank here is
--            a lost reference rather than a gap
--   unique   two jobs cannot share a number, compared without case or spaces
--
-- The next number skips any that somebody has already typed by hand, so a
-- manual MWP-0020 never collides with the sequence reaching 20.
-- ---------------------------------------------------------------------------

create sequence if not exists public.job_invoice_number_seq minvalue 1;

grant usage, select on sequence public.job_invoice_number_seq to authenticated;

create or replace function public.next_invoice_number()
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $next$
declare
  v_number text;
begin
  loop
    v_number := 'MWP-' || lpad(nextval('public.job_invoice_number_seq')::text, 4, '0');
    exit when not exists (
      select 1 from public.jobs
      where lower(btrim(invoice_number)) = lower(v_number)
    );
  end loop;

  return v_number;
end;
$next$;

comment on function public.next_invoice_number() is
  'The next unused MWP-#### invoice number. Filled in on insert by jobs_assign_invoice_number.';

-- ---------------------------------------------------------------------------
-- start after the highest number already in use, then fill the gaps
-- ---------------------------------------------------------------------------
do $backfill$
declare
  v_highest int;
  v_job     record;
  v_rows    int;
  v_filled  int := 0;
begin
  select max((regexp_match(btrim(invoice_number), '^MWP[- ]?([0-9]+)$', 'i'))[1]::int)
    into v_highest
  from public.jobs;

  if v_highest is null then
    perform setval('public.job_invoice_number_seq', 1, false);
  else
    perform setval('public.job_invoice_number_seq', v_highest, true);
  end if;

  for v_job in
    select id
    from public.jobs
    where invoice_number is null or btrim(invoice_number) = ''
    order by created_at, customer_name, id
  loop
    update public.jobs
    set invoice_number = public.next_invoice_number()
    where id = v_job.id;

    get diagnostics v_rows = row_count;

    if v_rows <> 1 then
      raise exception 'Numbering job % touched % rows, expected 1.', v_job.id, v_rows;
    end if;

    v_filled := v_filled + 1;
  end loop;

  if exists (select 1 from public.jobs where invoice_number is null or btrim(invoice_number) = '') then
    raise exception 'Some jobs are still without an invoice number after numbering % of them.', v_filled;
  end if;
end;
$backfill$;

create unique index if not exists jobs_invoice_number_key
  on public.jobs (lower(btrim(invoice_number)));

-- ---------------------------------------------------------------------------
-- new jobs are numbered, and a number is never cleared
-- ---------------------------------------------------------------------------
create or replace function public.jobs_assign_invoice_number()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $assign$
begin
  if new.invoice_number is null or btrim(new.invoice_number) = '' then
    if tg_op = 'INSERT' then
      new.invoice_number := public.next_invoice_number();
      return new;
    end if;

    raise exception 'A job always has an invoice number. Type the number you want rather than clearing it.'
      using errcode = 'WB027';
  end if;

  new.invoice_number := btrim(new.invoice_number);
  return new;
end;
$assign$;

drop trigger if exists jobs_assign_invoice_number on public.jobs;

create trigger jobs_assign_invoice_number
  before insert or update of invoice_number on public.jobs
  for each row execute function public.jobs_assign_invoice_number();

-- Last, once every row has one. A before trigger runs ahead of this check, so
-- an insert with no number is filled rather than refused.
alter table public.jobs alter column invoice_number set not null;
