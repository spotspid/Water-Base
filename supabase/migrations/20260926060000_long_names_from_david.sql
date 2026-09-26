-- The long names, in David's words.
--
-- A build sheet has two names. "Flagship Bundle" is what the office calls it.
-- The long name is the sentence a customer reads on the quote email and in the
-- systems box of the agreement they sign. The column has existed since
-- 20260922020000 and has been null on all five sheets ever since, so every
-- customer document has printed the office label: two signed agreements say
-- the system sold was "Custom".
--
-- Four sheets get a name here. Custom does not, because there is no one true
-- sentence for a sheet whose parts are chosen per job.
--
-- Two changes to the composing, both from the same brief:
--
--   the clause is shorter   "plus under sink tanked reverse osmosis system for
--                           drinking water" rather than the longer version
--                           with "and separate faucet", which said in twelve
--                           words what the RO line already implies.
--
--   a sheet that already     RO Only is an RO. Composing the clause onto it
--   names an RO gets no      produced "Under sink tanked reverse osmosis unit
--   clause                   for perfectly clean drinking water plus under
--                            sink tanked reverse osmosis system for drinking
--                            water". The rule is the label's own wording
--                            rather than a flag on the row, so it holds for
--                            whatever anybody types on the Build sheets page.

create or replace function public.compose_system_long_name(p_long_label text, p_ro_type text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when nullif(btrim(coalesce(p_long_label, '')), '') is null then null
    -- The sheet already names a reverse osmosis unit, so the clause would say
    -- it twice.
    when btrim(p_long_label) ~* 'reverse osmosis' then btrim(p_long_label)
    else btrim(
      btrim(p_long_label)
      || case btrim(coalesce(p_ro_type, ''))
           when 'Tank Style' then ' plus under sink tanked reverse osmosis system for drinking water'
           when 'Tankless'   then ' plus under sink tankless reverse osmosis system for drinking water'
           else ''
         end
    )
  end
$function$;

update public.system_templates
set long_label = case label
  when 'Well Water Bundle' then 'Whole home dual tank air injection well system for softening and filtration'
  when 'Flagship Bundle'   then 'Whole home single tank mixed bed system for filtration and softening'
  when 'Softener Only'     then 'Whole home single tank water softener'
  when 'RO Only'           then 'Under sink tanked reverse osmosis unit for perfectly clean drinking water'
end
where label in ('Well Water Bundle', 'Flagship Bundle', 'Softener Only', 'RO Only');

-- Every job already written carries a stored copy, composed when it was saved.
-- The trigger only fires on a write, so without this the new names would reach
-- documents for jobs written from today and nothing else.
update public.jobs j
set system_long_name = public.compose_system_long_name(t.long_label, j.ro_type)
from public.system_templates t
where t.id = j.template_id;

do $$
declare
  v_missing int;
  v_ro text;
  v_flagship text;
  v_noro text;
begin
  select count(*) into v_missing
  from public.system_templates
  where label <> 'Custom' and coalesce(btrim(long_label), '') = '';
  if v_missing > 0 then
    raise exception '% sheets other than Custom still have no long name', v_missing;
  end if;

  -- RO Only says it once.
  select public.compose_system_long_name(long_label, 'Tank Style') into v_ro
  from public.system_templates where label = 'RO Only';
  if v_ro <> 'Under sink tanked reverse osmosis unit for perfectly clean drinking water' then
    raise exception 'RO Only composed as %', v_ro;
  end if;

  -- And a whole home sheet gains the clause.
  select public.compose_system_long_name(long_label, 'Tank Style') into v_flagship
  from public.system_templates where label = 'Flagship Bundle';
  if v_flagship not like '%plus under sink tanked reverse osmosis system for drinking water' then
    raise exception 'Flagship Bundle composed as %', v_flagship;
  end if;

  -- A job with no RO gains nothing.
  select public.compose_system_long_name(long_label, 'No RO') into v_noro
  from public.system_templates where label = 'Softener Only';
  if v_noro <> 'Whole home single tank water softener' then
    raise exception 'Softener Only with no RO composed as %', v_noro;
  end if;

  -- Custom is deliberately still null, so its jobs keep printing the short
  -- name until somebody decides what it should say.
  if (select long_label from public.system_templates where label = 'Custom') is not null then
    raise exception 'Custom has a long name, which was not part of this';
  end if;
end $$;

notify pgrst, 'reload schema';
