-- Four more ways customers pay, from the Sept 17 call.
--
-- Zelle, ACH and wire are how most of the larger jobs actually settle, and
-- they were being filed under Check or left blank because the list did not
-- have them. Advance is a financing company, named with its kind in brackets
-- so it reads beside Financing and Affirm as one of that family rather than as
-- a stage in a payment plan.
--
-- The existing five stay: Cash, Check, Credit Card, Financing, Affirm.
--
-- Applied to the live project through the REST API on the day, because the
-- migration connector had lost its authorisation. Written so it is harmless if
-- it is applied again: a type already present is left as it is, including one
-- somebody has since switched off in Settings.

insert into public.settings_options (list_key, value, sort_order, active)
values
  ('payment_type', 'Zelle', 60, true),
  ('payment_type', 'ACH', 70, true),
  ('payment_type', 'Wire', 80, true),
  ('payment_type', 'Advance (financing)', 90, true)
on conflict (list_key, value) do nothing;

do $$
begin
  if (
    select count(*) from public.settings_options
    where list_key = 'payment_type'
      and value in ('Cash', 'Check', 'Credit Card', 'Financing', 'Affirm',
                    'Zelle', 'ACH', 'Wire', 'Advance (financing)')
  ) <> 9 then
    raise exception 'the payment types are not the nine agreed on the call';
  end if;
end $$;
