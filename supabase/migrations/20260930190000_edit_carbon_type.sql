-- Carbon type, editable on an existing job.
--
-- Carbon type arrived as a customer pick on the new job form and reached the
-- documents, but update_job_details never learned about it, so the one place
-- a job is corrected could not touch it. Somebody who picked Standard and
-- meant Catalytic had no way to say so, and the drawer silently hid the field
-- rather than admit it.
--
-- Two things matter here beyond adding a parameter:
--
-- 1. Carbon type decides which carbon cartridge the sheet resolves to, so it
--    belongs in the list of picks an installed job refuses to change. The
--    ledger rows were written from the old answer and the ledger is append
--    only. Leaving it editable would let the job disagree with what left the
--    shelf, which is the fault the other locks exist to prevent.
--
-- 2. The existing 17 argument form keeps working and keeps the job's current
--    carbon type, so nothing that calls it today starts blanking a pick it
--    has never heard of.

create or replace function public.update_job_details(
  p_job_id uuid, p_customer_name text, p_phone text, p_customer_email text,
  p_address text, p_city text, p_water_source text, p_template_id uuid,
  p_sale_price numeric, p_payment_type text, p_faucet_finish text,
  p_ro_type text, p_valve_type text, p_invoice_number text,
  p_site_conditions text, p_notes text, p_deposit_amount numeric,
  p_carbon_type text
) returns json
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job       public.jobs%rowtype;
  v_label     text;
  v_override  boolean;
  v_blocked   text[] := '{}';
  v_open      int := 0;
  v_units     int := 0;
  v_unresolved int := 0;
  v_name      text := nullif(btrim(coalesce(p_customer_name, '')), '');
  v_phone     text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email     text := nullif(btrim(coalesce(p_customer_email, '')), '');
  v_address   text := nullif(btrim(coalesce(p_address, '')), '');
  v_invoice   text := nullif(btrim(coalesce(p_invoice_number, '')), '');
  v_finish    text := nullif(btrim(coalesce(p_faucet_finish, '')), '');
  v_ro        text := nullif(btrim(coalesce(p_ro_type, '')), '');
  v_valve     text := nullif(btrim(coalesce(p_valve_type, '')), '');
  v_carbon    text := nullif(btrim(coalesce(p_carbon_type, '')), '');
  v_city      text := nullif(btrim(coalesce(p_city, '')), '');
  v_payment   text := nullif(btrim(coalesce(p_payment_type, '')), '');
  v_source    text := nullif(btrim(coalesce(p_water_source, '')), '');
  v_cleared   text[] := '{}';
begin
  if p_job_id is null then
    raise exception 'No job was given to edit.' using errcode = 'WB026';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;

  if not found then
    raise exception 'That job no longer exists. Reload the jobs list.' using errcode = 'WB026';
  end if;

  if v_name is null and nullif(btrim(coalesce(v_job.customer_name, '')), '') is not null then
    v_cleared := v_cleared || 'the customer name'::text;
  end if;

  if v_phone is null and nullif(btrim(coalesce(v_job.phone, '')), '') is not null then
    v_cleared := v_cleared || 'the phone number'::text;
  end if;

  if v_address is null and nullif(btrim(coalesce(v_job.address, '')), '') is not null then
    v_cleared := v_cleared || 'the address'::text;
  end if;

  if v_city is null and nullif(btrim(coalesce(v_job.city, '')), '') is not null then
    v_cleared := v_cleared || 'the city'::text;
  end if;

  if v_payment is null and nullif(btrim(coalesce(v_job.payment_type, '')), '') is not null then
    v_cleared := v_cleared || 'the payment type'::text;
  end if;

  if v_invoice is null and nullif(btrim(coalesce(v_job.invoice_number, '')), '') is not null then
    v_cleared := v_cleared || 'the invoice number'::text;
  end if;

  -- deposit, 1 of 3: a recorded deposit is not blanked. Zero says none.
  if p_deposit_amount is null and v_job.deposit_amount is not null then
    v_cleared := v_cleared || 'the deposit'::text;
  end if;

  if array_length(v_cleared, 1) is not null then
    raise exception
      '% cannot be emptied once set. Correct the value rather than clearing it, '
      'or leave it as it was. A field that was already blank on this job can stay blank.%',
      initcap(array_to_string(v_cleared, ', ')),
      case when 'the deposit' = any(v_cleared) then ' For no deposit, enter 0.' else '' end
      using errcode = 'WB026';
  end if;

  if v_source is null or v_source not in ('city', 'well') then
    raise exception 'Water source must be city or well.' using errcode = 'WB026';
  end if;

  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'That email address does not look right.' using errcode = 'WB026';
  end if;

  if p_sale_price is null or p_sale_price < 0 then
    raise exception 'Sale price must be zero or greater.' using errcode = 'WB026';
  end if;

  -- deposit, 2 of 3: sensible when present, in a sentence rather than as the
  -- check constraint's name
  if p_deposit_amount is not null and p_deposit_amount < 0 then
    raise exception 'The deposit must be zero or more.' using errcode = 'WB026';
  end if;

  if p_deposit_amount is not null and p_deposit_amount > p_sale_price then
    raise exception 'The deposit is more than the sale price. Lower the deposit, or raise the price.'
      using errcode = 'WB026';
  end if;

  select exists (select 1 from public.job_parts jp where jp.job_id = p_job_id)
    into v_override;

  if p_template_id is not null then
    select t.label into v_label from public.system_templates t where t.id = p_template_id;

    if v_label is null then
      raise exception 'That build sheet no longer exists. Reload and pick another.'
        using errcode = 'WB026';
    end if;
  elsif v_override then
    v_label := v_job.system_template;
  elsif v_job.template_id is not null then
    raise exception
      'Taking the build sheet off this job would leave it with no parts list at all, '
      'so it would install and record nothing. Pick another sheet, or list this '
      'job''s parts against the job first.'
      using errcode = 'WB026';
  else
    v_label := v_job.system_template;
  end if;

  if v_job.parts_deducted_at is not null then
    if p_template_id is distinct from v_job.template_id then
      v_blocked := v_blocked || 'the build sheet'::text;
    end if;

    if v_finish is distinct from v_job.faucet_finish then
      v_blocked := v_blocked || 'the faucet finish'::text;
    end if;

    if v_ro is distinct from v_job.ro_type then
      v_blocked := v_blocked || 'the RO type'::text;
    end if;

    if v_valve is distinct from v_job.valve_type then
      v_blocked := v_blocked || 'the valve type'::text;
    end if;

    -- the new one. Carbon type picks the cartridge, so it is as much a fact
    -- about what left the shelf as the valve or the RO unit is.
    if v_carbon is distinct from v_job.carbon_type then
      v_blocked := v_blocked || 'the carbon type'::text;
    end if;

    if v_invoice is distinct from v_job.invoice_number then
      v_blocked := v_blocked || 'the invoice number'::text;
    end if;

    if array_length(v_blocked, 1) is not null then
      raise exception
        'This job installed on % and its parts are in the ledger, which is append '
        'only. % cannot be changed: the ledger rows were written from %, and they '
        'record what actually left the shelf. Everything else on this job can still '
        'be edited. Reverse the install if the parts themselves were wrong.',
        to_char(v_job.parts_deducted_at, 'Mon FMDD, YYYY'),
        initcap(array_to_string(v_blocked, ', ')),
        case when array_length(v_blocked, 1) = 1 then 'it' else 'them' end
        using errcode = 'WB026';
    end if;
  end if;

  update public.jobs
  set customer_name   = coalesce(v_name, customer_name),
      phone           = coalesce(v_phone, phone),
      customer_email  = v_email,
      address         = coalesce(v_address, address),
      city            = v_city,
      water_source    = v_source,
      template_id     = p_template_id,
      system_template = v_label,
      sale_price      = p_sale_price,
      payment_type    = v_payment,
      faucet_finish   = v_finish,
      ro_type         = v_ro,
      valve_type      = v_valve,
      carbon_type     = v_carbon,
      invoice_number  = v_invoice,
      site_conditions = nullif(btrim(coalesce(p_site_conditions, '')), ''),
      notes           = nullif(btrim(coalesce(p_notes, '')), ''),
      -- deposit, 3 of 3
      deposit_amount  = p_deposit_amount
  where id = p_job_id;

  select count(*)::int, coalesce(sum(jr.quantity), 0)::int
    into v_open, v_units
  from public.job_reservations jr
  where jr.job_id = p_job_id and jr.released_at is null;

  select count(*)::int into v_unresolved
  from public.resolve_job_parts(p_job_id) r
  where not r.resolved;

  return json_build_object(
    'job_id',           p_job_id,
    'system_template',  v_label,
    'open_lines',       v_open,
    'units_committed',  v_units,
    'unresolved_lines', v_unresolved,
    'from_job_parts',   v_override,
    'claimed',          v_job.scheduled_date is not null
                          and v_job.status not in ('installed', 'cancelled')
                          and v_job.parts_deducted_at is null
  );
end;
$function$;

-- The 17 argument form becomes a wrapper that keeps the job's own carbon type,
-- exactly as the 16 argument form already keeps its deposit. An older caller
-- must not be able to blank a pick it does not know exists.
create or replace function public.update_job_details(
  p_job_id uuid, p_customer_name text, p_phone text, p_customer_email text,
  p_address text, p_city text, p_water_source text, p_template_id uuid,
  p_sale_price numeric, p_payment_type text, p_faucet_finish text,
  p_ro_type text, p_valve_type text, p_invoice_number text,
  p_site_conditions text, p_notes text, p_deposit_amount numeric
) returns json
language sql
set search_path to 'public', 'pg_temp'
as $function$
  select public.update_job_details(
    p_job_id, p_customer_name, p_phone, p_customer_email, p_address, p_city,
    p_water_source, p_template_id, p_sale_price, p_payment_type, p_faucet_finish,
    p_ro_type, p_valve_type, p_invoice_number, p_site_conditions, p_notes,
    p_deposit_amount,
    (select j.carbon_type from public.jobs j where j.id = p_job_id))
$function$;

-- Proof.
do $$
declare
  v_job     uuid;
  v_before  text;
  v_after   text;
  v_msg     text;
begin
  -- a job on a sheet with a carbon line, not yet installed
  select j.id into v_job
  from public.jobs j
  where j.parts_deducted_at is null and j.carbon_type is not null
  limit 1;

  if v_job is null then
    raise notice 'no uninstalled job carries a carbon type, so the edit path is unproven here';
    return;
  end if;

  select carbon_type into v_before from public.jobs where id = v_job;

  -- 1. the new form changes it
  perform public.update_job_details(
    v_job, j.customer_name, j.phone, j.customer_email, j.address, j.city,
    j.water_source, j.template_id, j.sale_price, j.payment_type, j.faucet_finish,
    j.ro_type, j.valve_type, j.invoice_number, j.site_conditions, j.notes,
    j.deposit_amount, 'Catalytic')
  from public.jobs j where j.id = v_job;

  select carbon_type into v_after from public.jobs where id = v_job;

  if v_after is distinct from 'Catalytic' then
    raise exception 'the 18 argument form did not set the carbon type: got %', v_after;
  end if;

  -- 2. the old form leaves it alone rather than blanking it
  perform public.update_job_details(
    v_job, j.customer_name, j.phone, j.customer_email, j.address, j.city,
    j.water_source, j.template_id, j.sale_price, j.payment_type, j.faucet_finish,
    j.ro_type, j.valve_type, j.invoice_number, j.site_conditions, j.notes,
    j.deposit_amount)
  from public.jobs j where j.id = v_job;

  select carbon_type into v_after from public.jobs where id = v_job;

  if v_after is distinct from 'Catalytic' then
    raise exception 'the 17 argument form blanked the carbon type: got %', v_after;
  end if;

  -- put it back the way it was found
  perform public.update_job_details(
    v_job, j.customer_name, j.phone, j.customer_email, j.address, j.city,
    j.water_source, j.template_id, j.sale_price, j.payment_type, j.faucet_finish,
    j.ro_type, j.valve_type, j.invoice_number, j.site_conditions, j.notes,
    j.deposit_amount, v_before)
  from public.jobs j where j.id = v_job;

  select carbon_type into v_after from public.jobs where id = v_job;

  if v_after is distinct from v_before then
    raise exception 'the job was not restored: was %, now %', v_before, v_after;
  end if;

  raise notice 'carbon type edits, and an old caller cannot blank it';
end $$;

-- An installed job refuses the change, in the same sentence as the other picks.
do $$
declare
  v_job uuid;
  v_msg text;
begin
  select j.id into v_job
  from public.jobs j
  where j.parts_deducted_at is not null
  limit 1;

  if v_job is null then
    raise notice 'no installed job to prove the lock against';
    return;
  end if;

  begin
    perform public.update_job_details(
      v_job, j.customer_name, j.phone, j.customer_email, j.address, j.city,
      j.water_source, j.template_id, j.sale_price, j.payment_type, j.faucet_finish,
      j.ro_type, j.valve_type, j.invoice_number, j.site_conditions, j.notes,
      j.deposit_amount,
      case when j.carbon_type = 'Catalytic' then 'Standard' else 'Catalytic' end)
    from public.jobs j where j.id = v_job;

    raise exception 'an installed job accepted a carbon type change';
  exception
    when sqlstate 'WB026' then
      get stacked diagnostics v_msg = message_text;

      if v_msg not like '%Carbon Type%' then
        raise exception 'the refusal did not name the carbon type: %', v_msg;
      end if;

      raise notice 'an installed job refuses it, naming the field';
  end;
end $$;
