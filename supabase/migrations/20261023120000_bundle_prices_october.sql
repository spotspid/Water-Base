-- New bundle prices, 23 October.
--
--   Flagship Bundle     2,999  ->  3,499
--   Well Water Bundle   3,799  ->  4,200
--
-- Everything else stays as it is.
--
-- This is a prefill, not a rewrite. A build sheet's price fills in the New job
-- form and nothing else: every job carries the price it was actually sold at,
-- on the job itself, so none of the twenty six already in the book moves. The
-- proof below checks exactly that, because a price change that quietly
-- restated last month's revenue would be far worse than one that did nothing.
--
-- Applied to both schemas. v2 keeps its own presets and may not read public,
-- so the figures are written twice on purpose rather than shared.

do $$
declare
  v_before numeric;
  v_after  numeric;
  v_rows   int;
begin
  -- what the already sold work totals, so it can be checked afterwards
  select coalesce(sum(sale_price), 0) into v_before
  from public.jobs where not coalesce(is_test, false);

  update public.system_templates set default_price = 3499.00 where label = 'Flagship Bundle';
  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Flagship Bundle matched % build sheets, expected 1.', v_rows;
  end if;

  update public.system_templates set default_price = 4200.00 where label = 'Well Water Bundle';
  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Well Water Bundle matched % build sheets, expected 1.', v_rows;
  end if;

  select coalesce(sum(sale_price), 0) into v_after
  from public.jobs where not coalesce(is_test, false);

  if v_after <> v_before then
    raise exception 'Changing a build sheet price moved the books from % to %.', v_before, v_after;
  end if;

  raise notice 'build sheet prices updated, and no job moved';
end $$;

-- The same two in the rebuild.
update v2.system_presets set price = 3499.00 where name = 'Flagship Bundle';
update v2.system_presets set price = 4200.00 where name = 'Well Water Bundle';

do $$
declare
  v_flag numeric;
  v_well numeric;
  v_ro   numeric;
begin
  select default_price into v_flag from public.system_templates where label = 'Flagship Bundle';
  select default_price into v_well from public.system_templates where label = 'Well Water Bundle';
  select default_price into v_ro from public.system_templates where label = 'RO Only';

  if v_flag <> 3499.00 or v_well <> 4200.00 then
    raise exception 'The live prices read % and %.', v_flag, v_well;
  end if;

  -- the ones that were meant to stay put
  if v_ro <> 1200.00 then
    raise exception 'RO Only should still be 1200 and reads %.', v_ro;
  end if;

  select price into v_flag from v2.system_presets where name = 'Flagship Bundle';
  select price into v_well from v2.system_presets where name = 'Well Water Bundle';

  if v_flag <> 3499.00 or v_well <> 4200.00 then
    raise exception 'The rebuild prices read % and %.', v_flag, v_well;
  end if;

  raise notice 'both schemas agree: flagship 3499, well 4200';
end $$;
