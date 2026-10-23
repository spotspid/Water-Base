-- New bundle prices, 23 October.
--
--   Flagship Bundle     2,999  ->  3,499
--   Well Water Bundle   4,200
--
-- Everything else stays as it is.
--
-- The same change was made to the live schema on the live branch, where it
-- belongs. This file is the rebuild's half, and it names only v2: a migration
-- here that reaches into public would stop the two schemas being renamable
-- past each other at cutover, which is the one rule this branch cannot break.
-- check:v2 fails on it, and did.
--
-- A preset price is a prefill. Every job carries the price it was sold at, on
-- the job, so changing this moves nothing already quoted.

update v2.system_presets set price = 3499.00 where name = 'Flagship Bundle';
update v2.system_presets set price = 4200.00 where name = 'Well Water Bundle';

do $$
declare
  v_flag numeric;
  v_well numeric;
  v_ro   numeric;
begin
  select price into v_flag from v2.system_presets where name = 'Flagship Bundle';
  select price into v_well from v2.system_presets where name = 'Well Water Bundle';
  select price into v_ro from v2.system_presets where name = 'RO Only';

  if v_flag is distinct from 3499.00 or v_well is distinct from 4200.00 then
    raise exception 'The rebuild prices read % and %.', v_flag, v_well;
  end if;

  -- the one that was meant to stay put
  if v_ro is distinct from 1200.00 then
    raise exception 'RO Only should still be 1200 and reads %.', v_ro;
  end if;

  raise notice 'flagship 3499, well 4200, nothing else moved';
end $$;
