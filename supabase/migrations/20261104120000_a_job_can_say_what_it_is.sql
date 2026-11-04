-- A job can say what it actually is.
--
-- The build sheet list has a "Custom" entry with no long label, no price and
-- no parts. Picking it left nowhere to write down what was being sold, and the
-- documents print the long label, so three real customers signed agreements
-- that described their purchase as the word "Custom":
--
--   April Y. Stone      Custom   $2,899
--   Prudhvi Yalavarthi  Custom   $3,949
--   Donna Burgess       Custom   $2,000
--
-- It is not only the Custom sheet. A customer who wants a bundle plus a length
-- of PEX replaced, or a second RO, is buying something no sheet describes, and
-- the only place that went was into a verbal agreement on a call.
--
-- So the description becomes typeable, on any job. It lands in the same column
-- the documents already read, system_long_name, which means both the customer
-- agreement and the work order pick it up with no change to either.
--
-- The column was computed until now: a trigger composed it from the sheet's
-- long label and the RO type on every change. That has to keep working, or
-- every bundle quote loses the sentence a customer reads. So a typed one is
-- marked as typed, and the trigger leaves those alone. Clearing the box hands
-- the job back to the trigger and the generated sentence returns.

alter table public.jobs
  add column if not exists system_long_name_typed boolean not null default false;

comment on column public.jobs.system_long_name_typed is
  'True when somebody typed system_long_name by hand. The composing trigger '
  'leaves those alone; clearing the description sets this false and the '
  'generated sentence comes back.';

-- Every existing value was composed, which is what the default says, so there
-- is nothing to backfill.

create or replace function public.jobs_set_long_name()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_long text;
begin
  -- Somebody wrote this one. Composing over it would throw away the only
  -- record of what a custom job actually is, which is the fault this column
  -- was made typeable to fix.
  if new.system_long_name_typed then
    return new;
  end if;

  select t.long_label into v_long
  from public.system_templates t
  where t.id = new.template_id;

  new.system_long_name := public.compose_system_long_name(v_long, new.ro_type);
  return new;
end
$fn$;

-- The flag joins the columns that wake the trigger, so clearing a typed
-- description recomposes the generated one in the same statement rather than
-- leaving the job with the description it just had removed.
drop trigger if exists jobs_set_long_name on public.jobs;

create trigger jobs_set_long_name
  before insert or update of template_id, ro_type, system_long_name_typed
  on public.jobs
  for each row
  execute function public.jobs_set_long_name();

-- The save, with somewhere to put it.
--
-- Three overloads of this function existed: sixteen parameters, seventeen, and
-- the eighteen the app actually calls. The two short ones were compatibility
-- shims that nothing in the database referenced and nothing in the app had
-- called for months, and PostgREST resolves an overloaded name by the keys it
-- is given, so a fourth would be one more way for a save to pick the wrong
-- function. They go.

drop function if exists public.update_job_details(
  uuid, text, text, text, text, text, text, uuid, numeric, text, text, text, text, text,
  text, text);

drop function if exists public.update_job_details(
  uuid, text, text, text, text, text, text, uuid, numeric, text, text, text, text, text,
  text, text, numeric);

drop function if exists public.update_job_details(
  uuid, text, text, text, text, text, text, uuid, numeric, text, text, text, text, text,
  text, text, numeric, text);

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
  p_system_description text
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
  text, text, numeric, text, text) to authenticated;

-- Proof. Structure only: the behaviour is exercised against a real job over
-- the API afterwards, which is a better test than a synthetic row that has to
-- guess at every not-null column on jobs.
do $$
declare
  v_overloads int;
  v_args text;
  v_watched text;
begin
  select count(*) into v_overloads
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_job_details';

  if v_overloads <> 1 then
    raise exception 'There are % versions of update_job_details. There must be exactly one.',
      v_overloads;
  end if;

  select pg_get_function_identity_arguments(p.oid) into v_args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_job_details';

  if v_args not like '%p_system_description text' then
    raise exception 'The one version does not take a description. It takes: %', v_args;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs'
      and column_name = 'system_long_name_typed'
  ) then
    raise exception 'jobs has no system_long_name_typed column.';
  end if;

  -- The trigger has to wake on the flag, or clearing a description would
  -- leave the job describing itself as whatever was just deleted.
  select pg_get_triggerdef(t.oid) into v_watched
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'jobs' and t.tgname = 'jobs_set_long_name';

  if v_watched not like '%system_long_name_typed%' then
    raise exception 'The composing trigger does not watch the flag: %', v_watched;
  end if;

  raise notice 'one save function, taking a description, and the trigger watches the flag';
end $$;
