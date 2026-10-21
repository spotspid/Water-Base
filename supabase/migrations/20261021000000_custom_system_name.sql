-- A Custom job says what it is.
--
-- The Custom build sheet has no long name, because its parts are chosen per
-- job and there is no one true sentence for it. So every quote, agreement and
-- work order for a Custom job has printed the word "Custom". David asked for a
-- box to say what the system actually is.
--
-- The words live on the job, and the trigger that composes system_long_name
-- uses them when the sheet has no long name of its own. A named sheet's long
-- name always wins, so the words cannot leak onto a Flagship job. The RO
-- clause is composed on as for any sheet, and left off when the words already
-- name a reverse osmosis unit.

alter table public.jobs
  add column if not exists custom_system_name text;

comment on column public.jobs.custom_system_name is
  'What a job on the Custom build sheet is, in the office''s words. Used as the long name when the sheet has none.';

alter table public.jobs
  drop constraint if exists jobs_custom_system_name_length;

alter table public.jobs
  add constraint jobs_custom_system_name_length
  check (custom_system_name is null or char_length(custom_system_name) <= 200);

create or replace function public.jobs_set_long_name()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_long text;
begin
  select t.long_label into v_long
  from public.system_templates t
  where t.id = new.template_id;

  new.system_long_name := public.compose_system_long_name(
    coalesce(nullif(btrim(v_long), ''), nullif(btrim(new.custom_system_name), '')),
    new.ro_type);
  return new;
end
$function$;

-- The words are now an input, so a change to them recomposes the name.
drop trigger if exists jobs_set_long_name on public.jobs;

create trigger jobs_set_long_name
before insert or update of template_id, ro_type, custom_system_name on public.jobs
for each row execute function public.jobs_set_long_name();

notify pgrst, 'reload schema';

-- Proof, rolled back so nothing in it survives.
do $$
declare
  v_custom   uuid;
  v_flagship uuid;
  v_job      uuid;
  v_name     text;
begin
 begin
  select id into v_custom from public.system_templates where label = 'Custom';
  select id into v_flagship from public.system_templates where label = 'Flagship Bundle';

  if v_custom is null or v_flagship is null then
    raise notice 'Custom or Flagship Bundle is missing, so the proof is skipped';
    raise exception 'skip' using errcode = 'WBPRF';
  end if;

  insert into public.jobs (customer_name, phone, city, system_template, template_id,
                           sale_price, status, ro_type, custom_system_name, is_test,
                           invoice_number)
  values ('Proof Custom', '000', 'Nowhere', 'Custom', v_custom, 1, 'quoted', 'No RO',
          'Whole home carbon filter with UV light', true,
          -- typed, so the proof does not use up a real invoice number
          'PROOF-CUSTOM')
  returning id, system_long_name into v_job, v_name;

  if v_name is distinct from 'Whole home carbon filter with UV light' then
    raise exception 'a Custom job did not take its own words: %', v_name;
  end if;

  update public.jobs set ro_type = 'Tank Style' where id = v_job returning system_long_name into v_name;
  if v_name not like 'Whole home carbon filter with UV light plus under sink tanked%' then
    raise exception 'the RO clause was not composed onto the words: %', v_name;
  end if;

  update public.jobs set custom_system_name = 'Iron filter' where id = v_job returning system_long_name into v_name;
  if v_name not like 'Iron filter plus%' then
    raise exception 'changing the words did not recompose the name: %', v_name;
  end if;

  update public.jobs set custom_system_name = null where id = v_job returning system_long_name into v_name;
  if v_name is not null then
    raise exception 'a Custom job with no words still has a name: %', v_name;
  end if;

  update public.jobs set system_template = 'Flagship Bundle', template_id = v_flagship,
                         custom_system_name = 'Should not print'
  where id = v_job returning system_long_name into v_name;
  if v_name like 'Should not print%' then
    raise exception 'the words leaked onto a named sheet: %', v_name;
  end if;

  raise exception 'custom system name proof passed' using errcode = 'WBPRF';
 exception
  when sqlstate 'WBPRF' then
    raise notice 'a Custom job prints its own words, and a named sheet ignores them';
 end;
end $$;
