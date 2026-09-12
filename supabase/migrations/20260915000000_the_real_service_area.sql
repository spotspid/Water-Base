-- The service cities become the places we actually work.
--
-- The list was the Ann Arbor corridor: Ann Arbor, Chelsea, Dexter, Dundee,
-- Milan, Monroe, Saline, Superior Township, Tecumseh, Whitmore Lake,
-- Ypsilanti. Not one customer is in any of them. Meanwhile Walter Radu is in
-- Commerce Township and Prudhvi Yalavarthi is in Troy, neither of which the
-- dropdown offered, which is why both were typed in as free text at load and
-- why two jobs still have no city at all.
--
-- A dropdown that does not contain the answer is worse than a text box. It
-- teaches people to skip the field.
--
-- Seven of the old entries survive because they are in both lists: Brighton,
-- Canton, Howell, Livonia, Northville, Plymouth, South Lyon. Those keep their
-- rows and take a new sort order rather than being deleted and recreated,
-- because a delete and insert would churn rows for no reason and the guard
-- would have to be argued with for nothing.
--
-- Deleting the rest is safe by construction rather than by my having checked:
-- settings_options_guard refuses to remove a value any record still uses, so
-- if a job had quietly been filed under Tecumseh this migration would fail
-- rather than strand it. Anything in use is deactivated instead, which keeps
-- it on the old record and off the new job form.
--
-- Kalkaska is the one that stays odd. Neil Toomey is there, it is two hours
-- north of everything else on this list, and it is not in the new area either.
-- It is deliberately not added: the form keeps whatever a job already has, so
-- his record is intact, and a one off job should not widen the service area on
-- the strength of itself.

-- ---------------------------------------------------------------------------
-- one spelling of one place
--
-- Ashley Fox is filed under "White Lake Twp" and the list calls it "White
-- Lake". Same township, two strings, and left alone she would sit outside the
-- service area on a technicality and never appear in a filter by city. The
-- canonical spelling is the one given for the list, so the job moves to it.
--
-- This is the only such rewrite, and it is here rather than done quietly by
-- hand so it is in the history with its reason.
-- ---------------------------------------------------------------------------
update public.jobs set city = 'White Lake' where city = 'White Lake Twp';

-- ---------------------------------------------------------------------------
-- anything still in use loses its place on the form but keeps its history
-- ---------------------------------------------------------------------------
update public.settings_options
set active = false
where list_key = 'service_city'
  and public.settings_option_usage('service_city', value) > 0
  and value not in (
    'Novi', 'Northville', 'Commerce Township', 'White Lake', 'Troy', 'Livonia',
    'Plymouth', 'Canton', 'Farmington Hills', 'West Bloomfield', 'Walled Lake',
    'Wixom', 'South Lyon', 'Milford', 'Brighton', 'Howell'
  );

-- ---------------------------------------------------------------------------
-- and the rest of the corridor goes
-- ---------------------------------------------------------------------------
delete from public.settings_options
where list_key = 'service_city'
  and public.settings_option_usage('service_city', value) = 0
  and value not in (
    'Novi', 'Northville', 'Commerce Township', 'White Lake', 'Troy', 'Livonia',
    'Plymouth', 'Canton', 'Farmington Hills', 'West Bloomfield', 'Walled Lake',
    'Wixom', 'South Lyon', 'Milford', 'Brighton', 'Howell'
  );

-- ---------------------------------------------------------------------------
-- the real area, in one alphabetical run
--
-- Alphabetical rather than by volume, because this is a list somebody scans
-- for a name they already know rather than a ranking they read.
-- ---------------------------------------------------------------------------
insert into public.settings_options (list_key, value, sort_order, active)
select 'service_city', v.value, v.sort_order, true
from (values
  ('Brighton', 10),
  ('Canton', 20),
  ('Commerce Township', 30),
  ('Farmington Hills', 40),
  ('Howell', 50),
  ('Livonia', 60),
  ('Milford', 70),
  ('Northville', 80),
  ('Novi', 90),
  ('Plymouth', 100),
  ('South Lyon', 110),
  ('Troy', 120),
  ('Walled Lake', 130),
  ('West Bloomfield', 140),
  ('White Lake', 150),
  ('Wixom', 160)
) as v(value, sort_order)
on conflict (list_key, value) do update
set sort_order = excluded.sort_order,
    active     = true;

-- ---------------------------------------------------------------------------
-- prove it
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
  v_stale text;
begin
  select count(*) into v_count
  from public.settings_options
  where list_key = 'service_city' and active;

  if v_count <> 16 then
    raise exception 'the service area has % active cities rather than 16', v_count;
  end if;

  select string_agg(value, ', ') into v_stale
  from public.settings_options
  where list_key = 'service_city'
    and active
    and value in ('Ann Arbor', 'Chelsea', 'Dexter', 'Dundee', 'Milan', 'Monroe',
                  'Saline', 'Superior Township', 'Tecumseh', 'Whitmore Lake', 'Ypsilanti');

  if v_stale is not null then
    raise exception 'the Ann Arbor corridor is still on the form: %', v_stale;
  end if;

  -- no job may have lost its city
  if exists (
    select 1 from public.jobs j
    where j.city is not null
      and not exists (
        select 1 from public.settings_options o
        where o.list_key = 'service_city' and o.value = j.city)
      and j.city not in ('Kalkaska')
  ) then
    raise exception 'a job is filed under a city that no longer exists anywhere';
  end if;
end $$;

notify pgrst, 'reload schema';
