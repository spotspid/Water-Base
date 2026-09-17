-- The service city list is emptied so Steve can refill it.
--
-- City on the job form is now a text field that suggests from this list rather
-- than a dropdown limited to it. The sixteen seeded on Sept 15 were a best
-- guess at the service area, and two real jobs had already gone in as free text
-- around the dropdown (Redford Township, Sterling Heights). From the Sept 17
-- call: clear the seeded names and leave the list for Steve.
--
-- Deleted where nothing uses them. Five are on a job's city (Brighton, Commerce
-- Township, Novi, Troy, White Lake), and settings_options_guard refuses to
-- delete a value a record still uses, so those five are switched off instead.
-- Off means they no longer suggest; Settings lists them with a Turn on button,
-- so Steve can bring any of them back rather than retyping it.
--
-- Nothing here touches jobs. A job keeps whatever city it was written with.
--
-- The guard block matters more than the change. This only runs while the
-- active list is still exactly the sixteen seeded names. Once Steve has added
-- or removed anything, a later run of this file does nothing at all, so it can
-- never delete a city he typed in.
--
-- Applied to the live project through the REST API on the day, because the
-- migration connector had lost its authorisation.

do $$
declare
  v_seeded text[] := array[
    'Brighton', 'Canton', 'Commerce Township', 'Farmington Hills', 'Howell',
    'Livonia', 'Milford', 'Northville', 'Novi', 'Plymouth', 'South Lyon',
    'Troy', 'Walled Lake', 'West Bloomfield', 'White Lake', 'Wixom'
  ];
  v_active text[];
begin
  select coalesce(array_agg(value order by value), '{}')
    into v_active
  from public.settings_options
  where list_key = 'service_city' and active;

  if v_active is distinct from (select array_agg(x order by x) from unnest(v_seeded) x) then
    raise notice 'service_city is no longer the seeded list, so it is left alone';
    return;
  end if;

  update public.settings_options
  set active = false
  where list_key = 'service_city'
    and value = any(v_seeded)
    and public.settings_option_usage('service_city', value) > 0;

  delete from public.settings_options
  where list_key = 'service_city'
    and value = any(v_seeded)
    and public.settings_option_usage('service_city', value) = 0;
end $$;
