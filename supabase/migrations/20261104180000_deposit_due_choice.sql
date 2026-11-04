-- The customer can be asked for the deposit at a time other than signing.
--
-- Until now every agreement and quote said the deposit was due at signing,
-- because that was the only time there was. Sales asked for a choice: upon
-- signing, 72 hours before the install, 24 hours before, and so on.
--
-- deposit_due is that choice, one of a short fixed list so the documents can
-- print a sentence for each. Every existing job was sold on "at signing", which
-- is what the default says, so there is nothing to backfill.
--
-- The save function takes it as a twentieth argument with a default, so the
-- page that is deployed now (which sends nineteen) keeps saving, and keeps the
-- deposit timing a job already has. There is still exactly one version.

alter table public.jobs
  add column if not exists deposit_due text not null default 'signing';

alter table public.jobs drop constraint if exists jobs_deposit_due_check;
alter table public.jobs
  add constraint jobs_deposit_due_check
  check (deposit_due in ('signing', '1_week', '72_hours', '24_hours'));

comment on column public.jobs.deposit_due is
  'When the agreed deposit is due: signing, 1_week, 72_hours or 24_hours '
  'before the install. Printed on the quote and the customer agreement.';

drop function if exists public.update_job_details(
  uuid, text, text, text, text, text, text, uuid, numeric, text, text, text, text, text,
  text, text, numeric, text, text);

create function public.update_job_details(
  p_job_id uuid,
  p_customer_name text,
  p_phone text,
  p_customer_email text,
  p_address text,
  p_city text,
  p_water_source text,
  p_template_id uuid,
  p_sale_price numeric,
  p_payment_type text,
  p_faucet_finish text,
  p_ro_type text,
  p_valve_type text,
  p_invoice_number text,
  p_site_conditions text,
  p_notes text,
  p_deposit_amount numeric,
  p_carbon_type text,
  p_system_description text,
  p_deposit_due text default null
)
returns json
language plpgsql
security definer
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
  v_carbon    text := nullif(btrim(coalesce(p_carbon_type, '')), '');
  v_city      text := nullif(btrim(coalesce(p_city, '')), '');
  v_payment   text := nullif(btrim(coalesce(p_payment_type, '')), '');
  v_source    text := nullif(btrim(coalesce(p_water_source, '')), '');
  v_desc      text := nullif(btrim(coalesce(p_system_description, '')), '');
  -- Null keeps what the job has, so a page that does not send it changes nothing.
  v_due       text := nullif(btrim(coalesce(p_deposit_due, '')), '');
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

  if p_deposit_amount is null and v_job.deposit_amount is not null then
    v_cleared := v_cleared || 'the deposit'::text;
  end if;

  -- The description is deliberately not on that list. Clearing it is a real
  -- instruction: it means "describe this the way the build sheet does", and
  -- the trigger below does exactly that.

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

  if p_deposit_amount is not null and p_deposit_amount < 0 then
    raise exception 'The deposit must be zero or more.' using errcode = 'WB026';
  end if;

  if p_deposit_amount is not null and p_deposit_amount > p_sale_price then
    raise exception 'The deposit is more than the sale price. Lower the deposit, or raise the price.'
      using errcode = 'WB026';
  end if;

  if v_due is not null and v_due not in ('signing', '1_week', '72_hours', '24_hours') then
    raise exception 'That is not one of the deposit due choices. Pick one from the list.'
      using errcode = 'WB026';
  end if;

  -- It prints in a box on two documents, so it has to fit in one.
  if v_desc is not null and length(v_desc) > 500 then
    raise exception
      'That description is % characters. It prints in a box on the agreement and the '
      'work order, so keep it under 500. Put the detail in the site conditions instead.',
      length(v_desc)
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

  -- The description, and the flag that tells the trigger whose it is. Setting
  -- the flag false is what brings the generated sentence back, because the
  -- flag is one of the columns the trigger watches.
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
      deposit_amount  = p_deposit_amount,
      deposit_due     = coalesce(v_due, deposit_due),
      system_long_name = case when v_desc is not null then v_desc else system_long_name end,
      system_long_name_typed = (v_desc is not null)
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

grant execute on function public.update_job_details(
  uuid, text, text, text, text, text, text, uuid, numeric, text, text, text, text, text,
  text, text, numeric, text, text, text) to authenticated;

-- The jobs list, the drawer and the quotes page read job_margin, which names
-- its columns one by one. The new column goes on the end, built from the live
-- definition rather than a copy of it, so this cannot put back an older view.
do $v$
declare
  v_def text := rtrim(pg_get_viewdef('public.job_margin'::regclass, true), '; ' || chr(10));
  v_new text;
begin
  if v_def like '%j.deposit_due%' then
    return;
  end if;

  v_new := replace(v_def, 'j.carbon_type' || chr(10) || '   FROM jobs j',
                          'j.carbon_type,' || chr(10) || '    j.deposit_due' || chr(10) || '   FROM jobs j');

  if v_new = v_def then
    raise exception 'job_margin does not end where expected, so deposit_due was not added to it.';
  end if;

  execute 'create or replace view public.job_margin as ' || v_new;
end $v$;

-- Proof.
do $$
declare
  v_overloads int;
  v_args text;
begin
  select count(*), max(pg_get_function_identity_arguments(p.oid)) into v_overloads, v_args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_job_details';

  if v_overloads <> 1 then
    raise exception 'There are % versions of update_job_details. There must be exactly one.', v_overloads;
  end if;

  if v_args not like '%p_deposit_due text%' then
    raise exception 'The one version does not take the deposit timing. It takes: %', v_args;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'job_margin' and column_name = 'deposit_due') then
    raise exception 'job_margin does not carry deposit_due.';
  end if;

  raise notice 'one save function, taking the deposit timing';
end $$;

notify pgrst, 'reload schema';
