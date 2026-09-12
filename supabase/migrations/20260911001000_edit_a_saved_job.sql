-- A saved job can be edited, and the claim follows the edit.
--
-- Everything the new job form captured was create only. Get the address wrong,
-- pick the wrong RO type, leave the valve type blank, and the only way back
-- was to write a new job. Two booked jobs are sitting in exactly that state
-- right now: the schedule says they cannot install because a valve line has
-- nothing to resolve against, and there was no screen anywhere that could
-- choose a valve.
--
-- One function rather than an update from the client, for three reasons.
--
-- The claim has to follow. Changing the sheet, the finish, the RO type or the
-- valve type changes which parts the job wants, and a claim computed before
-- the edit is wrong after it. The jobs_sync_reservations trigger already fires
-- on exactly those columns, so the claim follows the update inside the same
-- transaction. This function reads the result back and returns it, so the
-- drawer can say what moved rather than leaving somebody to guess.
--
-- An installed job has to refuse some of it. Not all of it: an address typo on
-- a job that installed last month is still worth fixing. But the fields the
-- ledger was written from are a record of what happened, and the ledger is
-- append only, so an edit to those would leave the two disagreeing with
-- nothing to say which is right. Those are refused by name, with the reason.
--
-- And the template link has one rule. A job naming a sheet it is not linked to
-- is the fault the build sheet migration went to some trouble to make
-- impossible, and an edit form posting a label is the obvious way to
-- reintroduce it. This function never takes a label. It takes the sheet's id,
-- looks the label up, and writes both from the row it found.
--
-- What this deliberately does not touch: status, scheduled_date, time_window,
-- installer_id, helper_id, install_date and payout_amount. Those are the
-- schedule's and the install's, they are already editable through schedule_job
-- and mark_job_installed and the crew panel, and a second path that wrote them
-- with a plain update is the bug that made "Mark scheduled" disagree with the
-- calendar. One writer each.

create or replace function public.update_job_details(
  p_job_id          uuid,
  p_customer_name   text,
  p_phone           text,
  p_customer_email  text,
  p_address         text,
  p_city            text,
  p_water_source    text,
  p_template_id     uuid,
  p_sale_price      numeric,
  p_payment_type    text,
  p_faucet_finish   text,
  p_ro_type         text,
  p_valve_type      text,
  p_invoice_number  text,
  p_site_conditions text,
  p_notes           text
)
returns json
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_job       public.jobs%rowtype;
  v_label     text;
  v_override  boolean;
  v_blocked   text[] := '{}';
  v_open      int := 0;
  v_units     int := 0;
  v_unresolved int := 0;
  v_name      text := btrim(coalesce(p_customer_name, ''));
  v_phone     text := btrim(coalesce(p_phone, ''));
  v_email     text := nullif(btrim(coalesce(p_customer_email, '')), '');
  v_address   text := btrim(coalesce(p_address, ''));
  v_invoice   text := btrim(coalesce(p_invoice_number, ''));
  v_finish    text := nullif(btrim(coalesce(p_faucet_finish, '')), '');
  v_ro        text := nullif(btrim(coalesce(p_ro_type, '')), '');
  v_valve     text := nullif(btrim(coalesce(p_valve_type, '')), '');
  v_city      text := nullif(btrim(coalesce(p_city, '')), '');
  v_payment   text := nullif(btrim(coalesce(p_payment_type, '')), '');
  v_source    text := nullif(btrim(coalesce(p_water_source, '')), '');
begin
  if p_job_id is null then
    raise exception 'No job was given to edit.' using errcode = 'WB026';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;

  if not found then
    raise exception 'That job no longer exists. Reload the jobs list.' using errcode = 'WB026';
  end if;

  -- -------------------------------------------------------------------------
  -- what a person typed
  -- -------------------------------------------------------------------------
  if v_name = '' then
    raise exception 'Customer name is required.' using errcode = 'WB026';
  end if;

  if v_phone = '' then
    raise exception 'Phone is required.' using errcode = 'WB026';
  end if;

  if v_address = '' then
    raise exception 'Address is required.' using errcode = 'WB026';
  end if;

  if v_invoice = '' then
    raise exception 'Invoice number is required.' using errcode = 'WB026';
  end if;

  if v_city is null then
    raise exception 'Pick a city.' using errcode = 'WB026';
  end if;

  if v_payment is null then
    raise exception 'Pick a payment type.' using errcode = 'WB026';
  end if;

  if v_source is null or v_source not in ('city', 'well') then
    raise exception 'Water source must be city or well.' using errcode = 'WB026';
  end if;

  -- The address the agreement is sent to. A typo here means it silently never
  -- arrives, which is why it is checked rather than accepted as typed.
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'That email address does not look right.' using errcode = 'WB026';
  end if;

  if p_sale_price is null or p_sale_price < 0 then
    raise exception 'Sale price must be zero or greater.' using errcode = 'WB026';
  end if;

  -- -------------------------------------------------------------------------
  -- the sheet, by id
  --
  -- A job with no sheet is legitimate only when it lists its own parts.
  -- Otherwise it is a job with no parts list at all, which is the Custom sheet
  -- problem by another name: it would install and record nothing.
  -- -------------------------------------------------------------------------
  select exists (select 1 from public.job_parts jp where jp.job_id = p_job_id)
    into v_override;

  if p_template_id is not null then
    select t.label into v_label from public.system_templates t where t.id = p_template_id;

    if v_label is null then
      raise exception 'That build sheet no longer exists. Reload and pick another.'
        using errcode = 'WB026';
    end if;
  elsif not v_override then
    raise exception
      'This job needs a build sheet, or its own parts list, or it would install '
      'and record no parts at all. Pick a sheet, or list the parts against the job.'
      using errcode = 'WB026';
  else
    v_label := v_job.system_template;
  end if;

  -- -------------------------------------------------------------------------
  -- what an installed job will not let go of
  --
  -- Collected rather than raised one at a time, so somebody who changed three
  -- of these is told about three rather than made to discover them in turn.
  -- -------------------------------------------------------------------------
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

  -- -------------------------------------------------------------------------
  -- the write
  --
  -- system_template comes off the sheet row rather than off the request, so a
  -- job cannot name one sheet and be linked to another. The reservation
  -- trigger fires from here on the columns that changed.
  -- -------------------------------------------------------------------------
  update public.jobs
  set customer_name   = v_name,
      phone           = v_phone,
      customer_email  = v_email,
      address         = v_address,
      city            = v_city,
      water_source    = v_source,
      template_id     = p_template_id,
      system_template = v_label,
      sale_price      = p_sale_price,
      payment_type    = v_payment,
      faucet_finish   = v_finish,
      ro_type         = v_ro,
      valve_type      = v_valve,
      invoice_number  = v_invoice,
      site_conditions = nullif(btrim(coalesce(p_site_conditions, '')), ''),
      notes           = nullif(btrim(coalesce(p_notes, '')), '')
  where id = p_job_id;

  -- What the claim looks like now the trigger has run.
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
$fn$;

revoke all on function public.update_job_details(
  uuid, text, text, text, text, text, text, uuid, numeric,
  text, text, text, text, text, text, text) from public;

grant execute on function public.update_job_details(
  uuid, text, text, text, text, text, text, uuid, numeric,
  text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- prove it, inside a block that rolls back
--
-- The one that matters is the valve: a booked job on a sheet with a valve line
-- has one unresolved line, choosing a valve resolves it, and the claim grows
-- by that part rather than staying where it was.
-- ---------------------------------------------------------------------------
do $$
declare
  v_job    public.jobs%rowtype;
  v_before int;
  v_after  int;
  v_valve  text;
  v_result json;
begin
  select j.* into v_job
  from public.jobs j
  where j.status = 'scheduled'
    and j.parts_deducted_at is null
    and j.scheduled_date is not null
    and j.valve_type is null
    and exists (
      select 1 from public.resolve_job_parts(j.id) r where not r.resolved
    )
  order by j.scheduled_date
  limit 1;

  if v_job.id is null then
    return;
  end if;

  select value into v_valve
  from public.settings_options
  where list_key = 'valve_type' and active
  order by sort_order
  limit 1;

  if v_valve is null then
    return;
  end if;

  select count(*)::int into v_before
  from public.job_reservations where job_id = v_job.id and released_at is null;

  begin
    v_result := public.update_job_details(
      v_job.id, v_job.customer_name, v_job.phone, v_job.customer_email,
      v_job.address, coalesce(v_job.city, 'Ann Arbor'), v_job.water_source,
      v_job.template_id, v_job.sale_price, coalesce(v_job.payment_type, 'Cash'),
      v_job.faucet_finish, v_job.ro_type, v_valve,
      coalesce(v_job.invoice_number, 'PROOF'), v_job.site_conditions, v_job.notes);

    if (v_result ->> 'unresolved_lines')::int <> 0 then
      raise exception 'choosing a valve left % unresolved lines',
        v_result ->> 'unresolved_lines';
    end if;

    select count(*)::int into v_after
    from public.job_reservations where job_id = v_job.id and released_at is null;

    if v_after <= v_before then
      raise exception 'choosing a valve did not claim it: % claims before, % after',
        v_before, v_after;
    end if;

    raise exception 'PROOF_ROLLBACK';
  exception
    when others then
      if sqlerrm <> 'PROOF_ROLLBACK' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- and prove the refusal, which is the half that protects the ledger
-- ---------------------------------------------------------------------------
do $$
declare
  v_job    public.jobs%rowtype;
  v_other  uuid;
  v_raised boolean := false;
begin
  select j.* into v_job
  from public.jobs j
  where j.parts_deducted_at is not null
  limit 1;

  if v_job.id is null then
    return;
  end if;

  select t.id into v_other
  from public.system_templates t
  where t.id is distinct from v_job.template_id
  limit 1;

  if v_other is null then
    return;
  end if;

  begin
    perform public.update_job_details(
      v_job.id, v_job.customer_name, v_job.phone, v_job.customer_email,
      v_job.address, coalesce(v_job.city, 'Ann Arbor'), v_job.water_source,
      v_other, v_job.sale_price, coalesce(v_job.payment_type, 'Cash'),
      v_job.faucet_finish, v_job.ro_type, v_job.valve_type,
      coalesce(v_job.invoice_number, 'PROOF'), v_job.site_conditions, v_job.notes);
  exception
    when sqlstate 'WB026' then
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'an installed job let its build sheet be changed';
  end if;
end $$;

notify pgrst, 'reload schema';
