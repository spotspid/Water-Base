-- The same suggestion, for a job that has not been saved yet.
--
-- The New job form has a build sheet, an RO type and an installer in its
-- state and no row anywhere, so the function that reads a job by id cannot
-- answer for it. This takes the three facts directly and the job version
-- delegates to it, so the drawer and the form cannot drift apart on what the
-- rate should be.

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

  v_has_ro := coalesce(v_map.has_ro_line, false)
    and coalesce(nullif(btrim(coalesce(p_ro_type, '')), ''), 'No RO') <> 'No RO';

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

create or replace function public.suggested_installer_pay(p_job_id uuid)
returns table (
  amount        numeric,
  rate_key      text,
  rate_label    text,
  source        text,
  installer_id  uuid,
  installer_name text,
  has_ro        boolean,
  reason        text
)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job public.jobs%rowtype;
begin
  select * into v_job from public.jobs where id = p_job_id;

  if not found then
    return query select null::numeric, null::text, null::text, 'none'::text, null::uuid, null::text, false,
      'That job no longer exists.'::text;
    return;
  end if;

  return query
  select s.amount, s.rate_key, s.rate_label, s.source, v_job.installer_id,
         s.installer_name, s.has_ro, s.reason
  from public.suggest_pay_for(v_job.template_id, v_job.ro_type, v_job.installer_id) s;
end;
$function$;

do $$
declare
  v_rate record;
begin
  select * into v_rate from public.suggested_installer_pay(
    (select id from public.jobs where customer_name = 'Bruce Weislik'));
  if v_rate.amount <> 400 or v_rate.source <> 'installer' then
    raise exception 'Bruce suggested % from %', v_rate.amount, v_rate.source;
  end if;

  -- Glen Hooker is a Well Water Bundle with a tanked RO: the dual tank line
  -- with an RO on it, which is the top of the card.
  select * into v_rate from public.suggested_installer_pay(
    (select id from public.jobs where customer_name = 'Glen Hooker'));
  if v_rate.amount <> 600 or v_rate.rate_key <> 'dual_ro' then
    raise exception 'Glen suggested % on %', v_rate.amount, v_rate.rate_key;
  end if;

  -- And the form's version answers the same for the same three facts.
  select * into v_rate from public.suggest_pay_for(
    (select template_id from public.jobs where customer_name = 'Glen Hooker'),
    'Tank Style',
    (select installer_id from public.jobs where customer_name = 'Glen Hooker'));
  if v_rate.amount <> 600 then
    raise exception 'the form version disagreed: %', v_rate.amount;
  end if;
end $$;

notify pgrst, 'reload schema';
