-- An RO type nobody has filled in is not a job with no RO.
--
-- The rate rule read a blank ro_type as "No RO" and dropped to the lower line,
-- so Samuelkutty Abraham's Flagship Bundle, which has an RO line on its sheet
-- and no pick recorded against it, offered $400 for a softener rather than
-- $500 for a softener plus an RO install. Five jobs were affected, all of them
-- loaded from signed agreements where the finish and the RO type were never
-- written down.
--
-- The sheet decides. A sheet with an RO line on it means the installer is
-- fitting one, which is the work being paid for, and the customer's choice of
-- tanked or tankless does not change the labour. The only thing that takes the
-- rate back down is somebody explicitly picking No RO, which is a decision
-- rather than a blank.
--
-- This is the same distinction the whole app has been moving to since
-- 20260926020000: a blank is not a zero and not a no. It is a blank.

create or replace function public.suggest_pay_for(
  p_template_id uuid,
  p_ro_type text,
  p_installer_id uuid
)
returns table (
  amount         numeric,
  rate_key       text,
  rate_label     text,
  source         text,
  installer_name text,
  has_ro         boolean,
  reason         text
)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_map    public.template_rate_map%rowtype;
  v_key    text;
  v_amount numeric;
  v_own    boolean;
  v_name   text;
  v_has_ro boolean;
  v_label  text;
begin
  select name into v_name from public.installers where id = p_installer_id;

  if p_template_id is null then
    return query select null::numeric, null::text, null::text, 'none'::text, v_name, false,
      'No build sheet is chosen, so there is no rate line to read.'::text;
    return;
  end if;

  select * into v_map from public.template_rate_map where template_id = p_template_id;

  -- The sheet says whether an RO is being fitted. Only an explicit No RO
  -- takes it back off; a pick nobody has made yet leaves the work as the
  -- sheet describes it.
  v_has_ro := coalesce(v_map.has_ro_line, false)
    and coalesce(nullif(btrim(coalesce(p_ro_type, '')), ''), '') is distinct from 'No RO';

  v_key := case when v_has_ro then v_map.rate_key_with_ro else v_map.rate_key end;

  if v_key is null then
    return query select null::numeric, null::text, null::text, 'none'::text, v_name, v_has_ro,
      format('The %s sheet has no rate line, so the pay has to be typed.',
             coalesce(v_map.label, 'chosen'))::text;
    return;
  end if;

  select label into v_label from public.install_rate_lines where key = v_key;

  select ir.amount into v_amount
  from public.installer_rates ir
  where ir.installer_id = p_installer_id and ir.rate_key = v_key;

  v_own := v_amount is not null;

  if v_amount is null then
    select default_amount into v_amount from public.install_rate_lines where key = v_key;
  end if;

  return query select
    v_amount,
    v_key,
    v_label,
    (case when v_own then 'installer' else 'card' end)::text,
    v_name,
    v_has_ro,
    (case
      when v_own then format('%s is paid %s for %s.', v_name, to_char(v_amount, 'FM$999,999.00'), lower(v_label))
      when v_name is null then format('The rate card pays %s for %s. No installer is assigned yet.',
        to_char(v_amount, 'FM$999,999.00'), lower(v_label))
      else format('The rate card pays %s for %s. %s has no rate of their own yet.',
        to_char(v_amount, 'FM$999,999.00'), lower(v_label), v_name)
    end)::text;
end;
$function$;

do $$
declare
  v_flagship uuid;
  v_softener uuid;
  v_rate record;
begin
  select id into v_flagship from public.system_templates where label = 'Flagship Bundle';
  select id into v_softener from public.system_templates where label = 'Softener Only';

  -- The fault, named: a sheet with an RO line and no pick recorded.
  select * into v_rate from public.suggest_pay_for(v_flagship, null, null);
  if v_rate.amount <> 500 or v_rate.rate_key <> 'softener_ro' then
    raise exception 'an unset RO on a Flagship offers % on %', v_rate.amount, v_rate.rate_key;
  end if;

  -- An empty string is the same kind of blank.
  select * into v_rate from public.suggest_pay_for(v_flagship, '   ', null);
  if v_rate.amount <> 500 then
    raise exception 'a blank RO string offers %', v_rate.amount;
  end if;

  -- The decision still counts.
  select * into v_rate from public.suggest_pay_for(v_flagship, 'No RO', null);
  if v_rate.amount <> 400 or v_rate.rate_key <> 'softener' then
    raise exception 'an explicit No RO offers % on %', v_rate.amount, v_rate.rate_key;
  end if;

  -- And a sheet with no RO line pays its base rate whatever the job says,
  -- which is what stops Bruce Weislik moving.
  select * into v_rate from public.suggest_pay_for(v_softener, 'Tank Style', null);
  if v_rate.amount <> 400 then
    raise exception 'a sheet with no RO line offers % with a tanked RO on the job', v_rate.amount;
  end if;
end $$;

notify pgrst, 'reload schema';
