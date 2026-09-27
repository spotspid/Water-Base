-- Tank Style on the five jobs that never had an RO type recorded.
--
-- All five are Flagship Bundle jobs loaded from signed agreements where the
-- customer's choices were not written down. The sheet carries an RO line, so
-- each of them is fitting one; nobody ever said which. The line therefore
-- named no part, the job costed itself without an RO, and a scheduled one
-- reserved no RO either, which is the kind of gap that turns up on the morning
-- of the install.
--
-- Tank Style because it is the ordinary choice and the one the New job form
-- now starts on. It is a pick, not a fact: if any of these turn out to be
-- tankless, change it on the job and the parts follow.
--
-- The faucet finish and the valve type stay unrecorded on purpose. Those are
-- two more picks nobody made, and inventing a finish would put a chrome faucet
-- on a van for a customer who asked for black. They keep showing as
-- unresolved lines, which is what they are.

update public.jobs
set ro_type = 'Tank Style'
where ro_type is null
  and customer_name in (
    'Samuelkutty Abraham',
    'Ashley Fox',
    'Itohan Faith Obasuyi',
    'Vladimir Hysi',
    'Steve'
  );

do $$
declare
  v_left int;
  v_unresolved int;
  v_parts numeric;
  v_ro int;
begin
  select count(*) into v_left
  from public.jobs
  where ro_type is null
    and customer_name in ('Samuelkutty Abraham', 'Ashley Fox', 'Itohan Faith Obasuyi',
                          'Vladimir Hysi', 'Steve');
  if v_left <> 0 then
    raise exception '% of the five still have no RO type', v_left;
  end if;

  -- The RO line resolves now, so each of them is two short rather than three:
  -- the faucet and the valve, which are still nobody's decision.
  select max(unresolved_lines), max(parts_cost_effective) into v_unresolved, v_parts
  from public.job_margin
  where customer_name in ('Samuelkutty Abraham', 'Ashley Fox', 'Itohan Faith Obasuyi',
                          'Vladimir Hysi', 'Steve');
  if v_unresolved <> 2 then
    raise exception 'they still have % unresolved lines', v_unresolved;
  end if;
  if v_parts <> 974.18 then
    raise exception 'their parts read % rather than 974.18', v_parts;
  end if;

  -- Samuelkutty is the only one booked, so he is the only one whose
  -- reservations move. The other four are sold or quoted and hold nothing.
  select count(*) into v_ro
  from public.job_reservation_lines
  where customer_name = 'Samuelkutty Abraham' and sku = 'RO-TANK-5ST';
  if v_ro <> 1 then
    raise exception 'Samuelkutty Abraham reserves % tanked ROs', v_ro;
  end if;
end $$;

notify pgrst, 'reload schema';
