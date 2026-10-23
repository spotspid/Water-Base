-- Make a v2 job something the documents can actually read.
--
-- send-agreement refuses a document when a required field has no value, and a
-- v2 quote failed four of them. Tested against the real matcher rather than
-- guessed: a job with only a name and an email is blocked on phone, systems,
-- sale_price and payment_schedule.
--
-- Three of those are the page's job to ask for. This migration fixes the one
-- that was mine.

-- 1. The columns the documents already read.
--
-- v2 called these system_name and system_description. The field map reads
-- job.system_template and job.system_long_name, so a v2 job with its system
-- filled in was still reported as having no system: the value was there under
-- a name nothing was looking for.
--
-- Renamed to match rather than teaching the field map a second set of names,
-- because one of those is free while the schema is empty and the other is a
-- fork that has to be maintained for ever.

alter table v2.jobs rename column system_name to system_template;
alter table v2.jobs rename column system_description to system_long_name;

-- 2. Invoice numbers, assigned rather than typed.
--
-- The work order will not send without one. Typing them by hand is how two
-- jobs end up as MWP-0022, and at a hundred dealers it is how two businesses
-- do.
--
-- The prefix belongs to the organisation, because every dealer wants their
-- own and nothing is computed across them. The counter belongs to the
-- organisation too, so one dealer's numbering is not pushed along by another's
-- sales.

alter table v2.organizations
  add column if not exists invoice_prefix text,
  add column if not exists next_invoice_number integer not null default 1;

update v2.organizations
set invoice_prefix = 'MWP'
where invoice_prefix is null and lower(name) = 'michigan water pros';

-- Anybody else gets initials, which is a starting point they can change.
update v2.organizations
set invoice_prefix = upper(left(regexp_replace(name, '[^a-zA-Z ]', '', 'g'), 3))
where invoice_prefix is null;

create or replace function v2.assign_invoice_number()
returns trigger
language plpgsql
security definer
set search_path to 'v2', 'pg_temp'
as $function$
declare
  v_prefix text;
  v_next   integer;
begin
  -- Only when a job becomes something that gets paperwork, and only once.
  if new.invoice_number is not null then
    return new;
  end if;

  if new.status = 'quoted' or new.status = 'cancelled' then
    return new;
  end if;

  -- for update, so two sales in the same second cannot take the same number
  select invoice_prefix, next_invoice_number into v_prefix, v_next
  from v2.organizations where id = new.org_id for update;

  if v_prefix is null then
    return new;
  end if;

  new.invoice_number := v_prefix || '-' || lpad(v_next::text, 4, '0');

  update v2.organizations
  set next_invoice_number = v_next + 1
  where id = new.org_id;

  return new;
end;
$function$;

drop trigger if exists jobs_assign_invoice_number on v2.jobs;

create trigger jobs_assign_invoice_number
before insert or update of status on v2.jobs
for each row execute function v2.assign_invoice_number();

notify pgrst, 'reload schema';

-- Proof.
do $$
declare
  v_org uuid;
  v_a   uuid;
  v_b   uuid;
  v_one text;
  v_two text;
begin
  -- 1. the columns the field map reads exist under those names
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'v2' and table_name = 'jobs' and column_name = 'system_template') then
    raise exception 'v2.jobs has no system_template, which is the name the documents read.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'v2' and table_name = 'jobs' and column_name = 'system_long_name') then
    raise exception 'v2.jobs has no system_long_name.';
  end if;

  select id into v_org from v2.organizations where lower(name) = 'michigan water pros';

  -- 2. a quote gets no number, because a quote has no paperwork to number
  insert into v2.jobs (org_id, customer_name, status) values (v_org, 'ZZ Quote', 'quoted')
  returning id into v_a;

  if (select invoice_number from v2.jobs where id = v_a) is not null then
    raise exception 'A quote was given an invoice number.';
  end if;

  -- 3. it gets one the moment it is sold, and keeps it
  update v2.jobs set status = 'sold' where id = v_a;
  select invoice_number into v_one from v2.jobs where id = v_a;

  if v_one is null or v_one !~ '^MWP-[0-9]{4}$' then
    raise exception 'A sold job has invoice number %, which is not the shape expected.', v_one;
  end if;

  update v2.jobs set status = 'scheduled' where id = v_a;

  if (select invoice_number from v2.jobs where id = v_a) <> v_one then
    raise exception 'The invoice number changed when the job moved on.';
  end if;

  -- 4. the next sale gets a different one
  insert into v2.jobs (org_id, customer_name, status) values (v_org, 'ZZ Sold', 'sold')
  returning id into v_b;

  select invoice_number into v_two from v2.jobs where id = v_b;

  if v_two = v_one then
    raise exception 'Two jobs were given the same invoice number, %.', v_one;
  end if;

  delete from v2.jobs where id in (v_a, v_b);

  raise notice 'documents can read the system, and invoice numbers assign themselves';
end $$;
