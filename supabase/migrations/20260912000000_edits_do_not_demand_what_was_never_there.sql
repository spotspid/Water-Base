-- The edit form stops demanding fields the job never had.
--
-- update_job_details validated like the new job form: city, payment type and
-- invoice number all required, every time. That is right for a job being
-- written now and wrong for the ones already in the table. Three back loaded
-- jobs have no payment type, two have no invoice number and one has no city,
-- so the form refused to save any of them on any field at all. Correcting a
-- misspelled street name was blocked by a missing invoice number from before
-- the field existed. A form that cannot save the records it was built to fix
-- is not a strict form, it is a broken one.
--
-- The rule now: a value that is present must be valid, and a gap that was
-- already there may stay a gap. What is still refused is clearing a value that
-- was set, because that is losing information rather than declining to invent
-- it, and it is the one case where the blank in the box means something
-- different from the blank in the row.
--
-- So the question each check asks is not "is this empty" but "is this empty
-- now and was it filled before". Read from the locked row, which is the state
-- as of this transaction, so two people editing at once cannot talk each other
-- into clearing a field between them.
--
-- The picks are untouched by all this. faucet_finish, ro_type and valve_type
-- were already optional here, and the unresolved line count is what says
-- whether the job can install.

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
  v_name      text := nullif(btrim(coalesce(p_customer_name, '')), '');
  v_phone     text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email     text := nullif(btrim(coalesce(p_customer_email, '')), '');
  v_address   text := nullif(btrim(coalesce(p_address, '')), '');
  v_invoice   text := nullif(btrim(coalesce(p_invoice_number, '')), '');
  v_finish    text := nullif(btrim(coalesce(p_faucet_finish, '')), '');
  v_ro        text := nullif(btrim(coalesce(p_ro_type, '')), '');
  v_valve     text := nullif(btrim(coalesce(p_valve_type, '')), '');
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

  -- -------------------------------------------------------------------------
  -- emptying a field that had something in it
  --
  -- Collected rather than raised one at a time, so somebody who cleared two
  -- boxes is told about two. NOT NULL columns are in here as well: the
  -- constraint would catch a null but not an empty string, and an empty
  -- customer name is a row nobody can find again.
  -- -------------------------------------------------------------------------
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

  if array_length(v_cleared, 1) is not null then
    raise exception
      '% cannot be emptied once set. Correct the value rather than clearing it, '
      'or leave it as it was. A field that was already blank on this job can stay blank.',
      initcap(array_to_string(v_cleared, ', '))
      using errcode = 'WB026';
  end if;

  -- -------------------------------------------------------------------------
  -- a value that is there has to be a sensible one
  --
  -- water_source is the exception that is still always required, because the
  -- column is NOT NULL with no blank rows and it is a two way choice rather
  -- than something anybody could have failed to record.
  -- -------------------------------------------------------------------------
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
  -- Same gap rule. A job that already had no sheet and no parts of its own is
  -- saveable as it stands, because that is the state it was already in and
  -- refusing it would be the original fault again. Taking the sheet off a job
  -- that had one, with nothing to put in its place, is still refused: that is
  -- a job being emptied rather than one that was never filled.
  -- -------------------------------------------------------------------------
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

  -- -------------------------------------------------------------------------
  -- what an installed job will not let go of
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
  -- The NOT NULL columns keep what they had when the request leaves them
  -- blank, which by this point can only be a blank that was already there.
  -- Writing the empty string instead would turn a legacy gap into a value.
  -- -------------------------------------------------------------------------
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
      invoice_number  = v_invoice,
      site_conditions = nullif(btrim(coalesce(p_site_conditions, '')), ''),
      notes           = nullif(btrim(coalesce(p_notes, '')), '')
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
-- The job this was built for: one with a gap already in it. Saving an unrelated
-- field has to work and has to leave the gap alone, and clearing a field that
-- was filled has to be refused.
-- ---------------------------------------------------------------------------
do $$
declare
  v_job    public.jobs%rowtype;
  v_after  public.jobs%rowtype;
  v_raised boolean := false;
begin
  select j.* into v_job
  from public.jobs j
  where j.parts_deducted_at is null
    and (j.payment_type is null or j.invoice_number is null or j.city is null)
    and nullif(btrim(coalesce(j.address, '')), '') is not null
  limit 1;

  if v_job.id is null then
    return;
  end if;

  begin
    -- an edit to one field, with every existing gap passed back as a gap
    perform public.update_job_details(
      v_job.id, v_job.customer_name, v_job.phone, v_job.customer_email,
      v_job.address || ' Apt 2', v_job.city, v_job.water_source,
      v_job.template_id, v_job.sale_price, v_job.payment_type,
      v_job.faucet_finish, v_job.ro_type, v_job.valve_type,
      v_job.invoice_number, v_job.site_conditions, v_job.notes);

    select * into v_after from public.jobs where id = v_job.id;

    if v_after.address <> v_job.address || ' Apt 2' then
      raise exception 'the address did not save on a job with a gap in it';
    end if;

    if v_after.payment_type is distinct from v_job.payment_type
       or v_after.invoice_number is distinct from v_job.invoice_number
       or v_after.city is distinct from v_job.city then
      raise exception 'saving one field changed a gap into something else';
    end if;

    -- and clearing a field that had a value is still refused
    begin
      perform public.update_job_details(
        v_job.id, v_job.customer_name, v_job.phone, v_job.customer_email,
        '', v_job.city, v_job.water_source,
        v_job.template_id, v_job.sale_price, v_job.payment_type,
        v_job.faucet_finish, v_job.ro_type, v_job.valve_type,
        v_job.invoice_number, v_job.site_conditions, v_job.notes);
    exception
      when sqlstate 'WB026' then
        v_raised := true;
    end;

    if not v_raised then
      raise exception 'an address that was set was allowed to be emptied';
    end if;

    raise exception 'PROOF_ROLLBACK';
  exception
    when others then
      if sqlerrm <> 'PROOF_ROLLBACK' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
