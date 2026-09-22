-- A build sheet gets a second name, the one a customer reads.
--
-- "Flagship Bundle" is what the office calls it. It tells a customer nothing,
-- and it is what the quote, the agreement and the work order have all been
-- printing. The sheet now carries a long descriptive name beside the short
-- one, and the documents use the long one.
--
-- The long name on the job is composed, not typed: the sheet's base system
-- name, then a clause for the RO the customer picked.
--
--   Tank Style  plus under sink tanked reverse osmosis system and separate
--               faucet for drinking water
--   Tankless    plus under sink tankless reverse osmosis system and separate
--               faucet for drinking water
--   No RO       nothing at all
--
-- so one written base name covers all three ways a sheet can be sold, and the
-- RO clause cannot disagree with the parts, since both come from ro_type.
--
-- It is stored on the job rather than worked out when a document is printed.
-- A job that was sold as one thing keeps saying so when the sheet is renamed
-- or its wording is improved, the same reason system_template has always been
-- copied onto the job. It is composed again if the sheet or the RO type
-- changes, because until the job is sent those are corrections, not history.
--
-- long_label is null until somebody writes it. Where it is null the documents
-- print exactly what they print today, so this migration changes no wording
-- anywhere on its own.

alter table public.system_templates
  add column if not exists long_label text;

comment on column public.system_templates.long_label is
  'The descriptive name a customer reads, without any RO clause. Null means the documents fall back to the short label.';

alter table public.jobs
  add column if not exists system_long_name text;

comment on column public.jobs.system_long_name is
  'The sheet long name with this job''s RO clause, composed when the job is written. Null when the sheet has no long name.';

-- ---------------------------------------------------------------------------
-- the composer
-- ---------------------------------------------------------------------------

/*
 * The long name for one job, or null when the sheet has no long name.
 *
 * Null rather than a fallback to the short label, so a caller can tell the
 * difference between "this sheet has a customer facing name" and "it does
 * not" and decide what to print. The documents fall back; a report might not.
 */
create or replace function public.compose_system_long_name(
  p_long_label text,
  p_ro_type text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(btrim(coalesce(p_long_label, '')), '') is null then null
    else btrim(
      btrim(p_long_label)
      || case btrim(coalesce(p_ro_type, ''))
           when 'Tank Style' then ' plus under sink tanked reverse osmosis system and separate faucet for drinking water'
           when 'Tankless'   then ' plus under sink tankless reverse osmosis system and separate faucet for drinking water'
           else ''
         end
    )
  end
$$;

comment on function public.compose_system_long_name(text, text) is
  'A build sheet long name with the RO clause for one job''s RO type. Null when the sheet has no long name.';

-- ---------------------------------------------------------------------------
-- keeping it on the job
-- ---------------------------------------------------------------------------

create or replace function public.jobs_set_long_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_long text;
begin
  select t.long_label into v_long
  from public.system_templates t
  where t.id = new.template_id;

  new.system_long_name := public.compose_system_long_name(v_long, new.ro_type);
  return new;
end $$;

-- Only when the sheet or the RO type moves. Every other edit leaves the name
-- exactly as it was written, including on an installed job.
drop trigger if exists jobs_set_long_name on public.jobs;
create trigger jobs_set_long_name
  before insert or update of template_id, ro_type on public.jobs
  for each row execute function public.jobs_set_long_name();

-- Existing jobs get theirs now, so the column is never half filled. Every
-- long_label is null today, so this writes null to all of them and changes no
-- document; it is here so that writing a long name later does not leave the
-- jobs that already exist behind.
update public.jobs j
set system_long_name = public.compose_system_long_name(
  (select t.long_label from public.system_templates t where t.id = j.template_id),
  j.ro_type
)
where system_long_name is distinct from public.compose_system_long_name(
  (select t.long_label from public.system_templates t where t.id = j.template_id),
  j.ro_type
);

-- ---------------------------------------------------------------------------
-- proof
-- ---------------------------------------------------------------------------
--
-- Against a sheet and a job made here and removed here. The job carries its
-- own invoice number: a blank one draws from job_invoice_number_seq, which
-- does not roll back.

do $$
declare
  v_tpl uuid;
  v_job uuid;
  v_seq bigint;
  v_name text;
  v_base text := 'Whole home water softening system';
begin
  select last_value into v_seq from public.job_invoice_number_seq;

  -- the composer, on its own
  if public.compose_system_long_name(v_base, 'Tank Style')
     <> v_base || ' plus under sink tanked reverse osmosis system and separate faucet for drinking water' then
    raise exception 'the tanked clause is wrong: %', public.compose_system_long_name(v_base, 'Tank Style');
  end if;
  if public.compose_system_long_name(v_base, 'Tankless')
     <> v_base || ' plus under sink tankless reverse osmosis system and separate faucet for drinking water' then
    raise exception 'the tankless clause is wrong: %', public.compose_system_long_name(v_base, 'Tankless');
  end if;
  if public.compose_system_long_name(v_base, 'No RO') <> v_base then
    raise exception 'No RO added something: %', public.compose_system_long_name(v_base, 'No RO');
  end if;
  if public.compose_system_long_name(v_base, null) <> v_base then
    raise exception 'a job with no RO type picked yet added something';
  end if;
  if public.compose_system_long_name(null, 'Tank Style') is not null
     or public.compose_system_long_name('   ', 'Tank Style') is not null then
    raise exception 'a sheet with no long name composed one anyway';
  end if;

  -- on a job
  insert into public.system_templates (label, long_label, default_price, active, sort_order)
  values ('PROOF sheet', v_base, 1000, false, 999)
  returning id into v_tpl;

  insert into public.jobs (customer_name, phone, address, city, water_source, system_template,
                           template_id, status, sale_price, ro_type, faucet_finish, is_test,
                           invoice_number)
  values ('PROOF long name', '555-0100', '1 Proof Lane', 'Novi', 'city', 'PROOF sheet',
          v_tpl, 'quoted', 1000, 'Tank Style', 'Chrome', true, 'PROOF-LONG-1')
  returning system_long_name into v_name;

  if v_name <> v_base || ' plus under sink tanked reverse osmosis system and separate faucet for drinking water' then
    raise exception 'the job did not compose its long name: %', v_name;
  end if;

  select id into v_job from public.jobs where invoice_number = 'PROOF-LONG-1';

  -- changing the RO type composes it again
  update public.jobs set ro_type = 'No RO' where id = v_job returning system_long_name into v_name;
  if v_name <> v_base then
    raise exception 'No RO left the RO clause on: %', v_name;
  end if;

  -- an unrelated edit leaves it alone, even if the sheet is renamed after
  update public.system_templates set long_label = 'Something else entirely' where id = v_tpl;
  update public.jobs set notes = 'an unrelated edit' where id = v_job
  returning system_long_name into v_name;
  if v_name <> v_base then
    raise exception 'an unrelated edit rewrote the long name to %', v_name;
  end if;

  -- and the short name is untouched throughout
  if (select system_template from public.jobs where id = v_job) <> 'PROOF sheet' then
    raise exception 'the short name changed';
  end if;

  delete from public.jobs where id = v_job;
  delete from public.system_templates where id = v_tpl;

  if (select last_value from public.job_invoice_number_seq) <> v_seq then
    raise exception 'this proof spent an invoice number';
  end if;

  -- nothing live changed: no sheet has a long name yet, so no job has one
  if exists (select 1 from public.jobs where system_long_name is not null) then
    raise exception 'a job has a long name before any sheet was given one';
  end if;
end $$;

notify pgrst, 'reload schema';
