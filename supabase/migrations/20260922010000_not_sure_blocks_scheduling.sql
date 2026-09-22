-- A job with a Not sure yet answer goes nowhere.
--
-- Not sure yet is fine on a quote: it is asked in the house, and what the
-- homeowner did not know can be found out later. It is not fine once a crew
-- is on its way. A drain run nobody measured is a return trip at $175, and an
-- unconfirmed main line is fittings that are not on the truck. So every Not
-- sure yet is answered, by David, before the job moves.
--
-- There is no single "scheduled" moment to hang this on. A job reaches the
-- field three separate ways, and each was checked against the live functions:
--
--   Parts reserved. sync_job_reservations claims a job's parts as soon as it
--   has a scheduled_date, whatever its status, and releases them when the
--   date is cleared. The date is the switch, not the status.
--
--   Parts picked up. mark_job_installed deducts the parts with no date at all:
--   a sold job can be marked installed straight from Sold.
--
--   Reaching an installer. send-agreement sends a work order to whoever is in
--   installer_id, needs no date, and calls DocuSeal (which emails the
--   installer) before it writes the agreements row. A trigger on agreements
--   would fire after the email had gone. What it does check first is that an
--   installer is assigned, so refusing the installer closes that route before
--   anything leaves the building, with the function as deployed today.
--
-- So the rule is on the job row, like the RO type rules: while any checklist
-- answer is Not sure yet, the job has no scheduled date, no installer, no
-- helper, is not Scheduled or Installed, and has no parts deducted. It is
-- checked on the row as it would be written, so it holds for every writer and
-- for every order of steps, including adding a Not sure yet to a job that is
-- already booked.
--
-- A quote is untouched. A quote cannot carry a date already
-- (jobs_guard_quote), the New quote form saves no crew, and no quote in the
-- data has one. Not sure yet on a quote saves and clears its amber as before.
--
-- The refusal names the open questions, in the order the checklist asks them,
-- with the labels the checklist shows, so the message is a to do list rather
-- than a code.

-- ---------------------------------------------------------------------------
-- the open questions, by name
-- ---------------------------------------------------------------------------

-- The labels are src/lib/salesChecklist.js's CHECKLIST_ITEMS, in its order.
-- check:checklist reads this file and fails if any label here is missing or
-- differs, so renaming a question on screen cannot leave this saying the old
-- name. Irrigation is absent because it never offers Not sure yet.
create or replace function public.checklist_not_sure_labels(p_checklist jsonb)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(q.label order by q.ord), '{}')
  from (values
    (1, 'people_in_home',         'People in home'),
    (2, 'bathrooms',              'Bathrooms'),
    (3, 'shutoff_location',       'Main water shutoff location'),
    (4, 'space_confirmed',        'Space confirmed for the unit'),
    (5, 'receptacle_within_6ft',  'Receptacle within 6 feet'),
    (6, 'drain_distance_ft',      'Drain distance from the install (feet)'),
    (7, 'main_line_size',         'Main water line size'),
    (8, 'main_line_material',     'Main water line material'),
    (9, 'removing_old_equipment', 'Removing old equipment')
  ) as q(ord, key, label)
  where jsonb_typeof(p_checklist) = 'object'
    and p_checklist ->> q.key = 'not_sure'
$$;

comment on function public.checklist_not_sure_labels(jsonb) is
  'The sales checklist questions still answered Not sure yet, as the checklist labels them, in checklist order.';

-- ---------------------------------------------------------------------------
-- the rule
-- ---------------------------------------------------------------------------

create or replace function public.jobs_guard_not_sure()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_open text[];
  v_moving text[] := '{}';
begin
  v_open := public.checklist_not_sure_labels(new.sales_checklist);

  if coalesce(array_length(v_open, 1), 0) = 0 then
    return new;
  end if;

  -- What this row would do that a Not sure yet forbids. Named, so the message
  -- says what was tried as well as what is open.
  if new.scheduled_date is not null then
    v_moving := v_moving || 'given a date'::text;
  end if;
  if new.installer_id is not null or new.helper_id is not null then
    v_moving := v_moving || 'given a crew'::text;
  end if;
  if new.status in ('scheduled', 'installed') then
    v_moving := v_moving || format('marked %s', new.status);
  end if;
  if new.parts_deducted_at is not null and new.status <> 'installed' then
    v_moving := v_moving || 'had its parts taken from stock'::text;
  end if;

  if coalesce(array_length(v_moving, 1), 0) = 0 then
    return new;
  end if;

  raise exception using
    errcode = 'WB031',
    message = format(
      'This job cannot be %s while the sales checklist still has %s marked Not sure yet: %s. '
      'Answer %s on the job''s sales checklist first.',
      array_to_string(v_moving, ', '),
      case when array_length(v_open, 1) = 1 then 'a question' else array_length(v_open, 1) || ' questions' end,
      array_to_string(v_open, ', '),
      case when array_length(v_open, 1) = 1 then 'it' else 'them' end
    ),
    hint = array_to_string(v_open, '|');
end $$;

-- BEFORE triggers run in name order. "unsure" sorts after
-- jobs_guard_install_status and jobs_guard_quote, so a malformed install or a
-- quote pushed straight to Scheduled is refused with that trigger's own, more
-- specific, sentence first. (Named jobs_guard_not_sure it would have run
-- before jobs_guard_quote, because n sorts before q.)
drop trigger if exists jobs_guard_unsure on public.jobs;
create trigger jobs_guard_unsure
  before insert or update on public.jobs
  for each row execute function public.jobs_guard_not_sure();

-- ---------------------------------------------------------------------------
-- proof
-- ---------------------------------------------------------------------------
--
-- On a job made here and removed here. It carries its own invoice number: a
-- blank one draws from job_invoice_number_seq, which does not roll back, and
-- that is how MWP-0020 was once spent on a job that never existed.

do $$
declare
  v_job uuid;
  v_seq bigint;
  v_installer uuid;
  v_labels text[];
  v_msg text;
  v_ok boolean;
begin
  select last_value into v_seq from public.job_invoice_number_seq;
  select id into v_installer from public.installers limit 1;

  -- the labels come back named and in checklist order
  v_labels := public.checklist_not_sure_labels(
    '{"drain_distance_ft":"not_sure","people_in_home":"not_sure","bathrooms":2,"irrigation_lines":"unknown"}');
  if v_labels <> array['People in home', 'Drain distance from the install (feet)'] then
    raise exception 'labels came back as %', v_labels;
  end if;
  if array_length(public.checklist_not_sure_labels('{}'), 1) is not null
     or array_length(public.checklist_not_sure_labels(null), 1) is not null
     or array_length(public.checklist_not_sure_labels('"x"'), 1) is not null then
    raise exception 'an empty or malformed checklist reported open questions';
  end if;

  -- a quote with Not sure yet saves, exactly as before
  insert into public.jobs (customer_name, phone, address, city, water_source, system_template,
                           template_id, status, sale_price, is_test, invoice_number, sales_checklist)
  values ('PROOF not sure', '555-0100', '1 Proof Lane', 'Novi', 'city', 'Softener Only',
          (select id from public.system_templates where label = 'Softener Only'),
          'quoted', 2999, true, 'PROOF-NOT-SURE-1',
          '{"drain_distance_ft":"not_sure","main_line_material":"not_sure"}')
  returning id into v_job;

  -- and can be sold with it, because selling is not dispatching
  update public.jobs set status = 'sold' where id = v_job;

  -- a date is refused, and the message names both open questions
  begin
    update public.jobs set scheduled_date = current_date + 7 where id = v_job;
    raise exception 'a date was accepted with Not sure yet open';
  exception when sqlstate 'WB031' then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%Drain distance from the install (feet)%'
       or v_msg not like '%Main water line material%'
       or v_msg not like '%given a date%' then
      raise exception 'the refusal did not name what is open: %', v_msg;
    end if;
  end;

  -- so no parts were reserved
  if exists (select 1 from public.job_reservations where job_id = v_job and released_at is null) then
    raise exception 'parts were reserved for a job with Not sure yet open';
  end if;

  -- a crew is refused, which closes the work order before DocuSeal is called
  if v_installer is not null then
    begin
      update public.jobs set installer_id = v_installer where id = v_job;
      raise exception 'an installer was accepted with Not sure yet open';
    exception when sqlstate 'WB031' then null;
    end;
  end if;

  -- Scheduled with no date is refused too
  begin
    update public.jobs set status = 'scheduled' where id = v_job;
    raise exception 'Scheduled was accepted with Not sure yet open';
  exception when sqlstate 'WB031' then null;
  end;

  -- installing takes nothing from stock
  begin
    perform public.mark_job_installed(v_job);
    raise exception 'an install went through with Not sure yet open';
  exception when sqlstate 'WB031' then null;
  end;
  if exists (select 1 from public.inventory_transactions where job_id = v_job) then
    raise exception 'stock moved for a job with Not sure yet open';
  end if;

  -- answer both, and the date goes through
  update public.jobs
  set sales_checklist = '{"drain_distance_ft":20,"main_line_material":"copper"}'
  where id = v_job;
  update public.jobs set scheduled_date = current_date + 7 where id = v_job;

  -- and a Not sure yet cannot be put back on a job that is booked
  begin
    update public.jobs set sales_checklist = '{"drain_distance_ft":"not_sure"}' where id = v_job;
    raise exception 'Not sure yet was added to a booked job';
  exception when sqlstate 'WB031' then null;
  end;

  -- clearing the date is always allowed, whatever is open
  update public.jobs set scheduled_date = null where id = v_job;
  update public.jobs set sales_checklist = '{"drain_distance_ft":"not_sure"}' where id = v_job;

  delete from public.jobs where id = v_job;

  if (select last_value from public.job_invoice_number_seq) <> v_seq then
    raise exception 'this proof spent an invoice number';
  end if;

  -- nothing in the live data is already on the wrong side of the rule
  select not exists (
    select 1 from public.jobs j
    where array_length(public.checklist_not_sure_labels(j.sales_checklist), 1) > 0
      and (j.scheduled_date is not null or j.installer_id is not null or j.helper_id is not null
           or j.status in ('scheduled', 'installed') or j.parts_deducted_at is not null)
  ) into v_ok;
  if not v_ok then
    raise exception 'a job already breaks the rule and would be stuck';
  end if;
end $$;

notify pgrst, 'reload schema';
