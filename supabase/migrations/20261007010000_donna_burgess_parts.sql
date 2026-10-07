-- Donna Burgess's parts list.
--
-- Her job was created on 2026-09-30 from a signed used equipment agreement and
-- put on the Custom sheet, which has no lines at all. So it reserved nothing,
-- cost nothing and reported a margin of the whole $2,000. This lists what she
-- is actually getting.
--
-- Five lines. Two are the units that came back off Prudhvi Yalavarthi's change
-- order on 2026-09-27 and have been on the shelf since; three are new.
--
-- The two used tanks are valued at the new SKU cost, because that is the only
-- cost either SKU has. There is no used SKU to put them on, which is a known
-- gap rather than an oversight: see "Used SKUs" in docs/known-issues.md. The
-- effect is that her parts cost is overstated by whatever a used tank is
-- really worth against a new one, and her margin understated by the same. Both
-- rows say so, so nobody reads $1,669.98 as a measured figure.
--
-- One open question is recorded rather than resolved. The carbon tank she is
-- getting is catalytic: her job says Catalytic, and the unit physically
-- removed from Prudhvi's was catalytic, because his went in on Sep 3 and the
-- only standard carbon tank MWP has ever bought arrived on Sep 10. But the
-- Sep 27 return was logged against CARB-ONLY-1054, the standard SKU, so on
-- paper the catalytic tank she takes is one of the two bought on Jul 16 and
-- the used one is still sitting under the standard SKU. The correction to that
-- is a separate decision and is not made here. It does not change this list:
-- she gets a catalytic tank either way.
--
-- This lists parts only. It does not schedule, reserve or deduct. Reservations
-- are made when a job takes a date, and this job has none.

do $$
declare
  v_job   uuid;
  v_rows  int;
  v_total numeric(10,2);
begin
  select id into v_job from public.jobs
  where invoice_number = 'MWP-0028' and customer_name = 'Donna Burgess';

  if v_job is null then
    raise exception 'Donna Burgess (MWP-0028) was not found.';
  end if;

  if exists (select 1 from public.job_parts where job_id = v_job) then
    raise exception 'Donna Burgess already has a parts list. Stopping rather than add a second.';
  end if;

  insert into public.job_parts (job_id, item_id, quantity, note, sort_order)
  select v_job, i.id, 1, x.note, x.sort_order
  from (values
    ('CARB-CAT-1054', 10,
      'Used. The catalytic carbon tank removed from Prudhvi Yalavarthi''s job under change '
      || 'order 11017160 and returned to stock on Sep 27. Valued at the new SKU cost because '
      || 'there is no used SKU to value it on, so this line overstates what it cost us. '
      || 'Note that the Sep 27 return was logged against the standard carbon SKU; the unit '
      || 'is catalytic and that correction is still open.'),
    ('SALTFREE-1054', 20,
      'Used. The salt free conditioner removed from Prudhvi Yalavarthi''s job under change '
      || 'order 11017160 and returned to stock on Sep 27. Valued at the new SKU cost because '
      || 'there is no used SKU to value it on, so this line overstates what it cost us.'),
    ('RO-TANK-5ST', 30, 'New. Tanked reverse osmosis unit.'),
    ('RO-ALK-FILT', 40, 'New. Alkaline mineral filter with fittings.'),
    ('FCT-CHROME', 50,
      'New. The faucet finish was never recorded on this job, so chrome is assumed. '
      || 'Confirm with the customer and change the line if it is wrong: nickel, black and '
      || 'gold are the same money or close to it, so this is about what she wanted rather '
      || 'than about cost.')
  ) as x(sku, sort_order, note)
  join public.inventory_items i on i.sku = x.sku;

  get diagnostics v_rows = row_count;

  if v_rows <> 5 then
    raise exception 'Listing Donna Burgess''s parts wrote % lines, expected 5. A SKU did not match.', v_rows;
  end if;

  select sum(i.unit_cost * jp.quantity) into v_total
  from public.job_parts jp
  join public.inventory_items i on i.id = jp.item_id
  where jp.job_id = v_job;

  raise notice 'Donna Burgess: 5 lines, parts cost %', v_total;
end $$;

-- Proof.
do $$
declare
  v_job        uuid;
  v_lines      int;
  v_unresolved int;
  v_total      numeric(10,2);
  v_basis      text;
begin
  select id into v_job from public.jobs where invoice_number = 'MWP-0028';

  -- 1. every line resolves to a real item with a cost, so the job can be costed
  select count(*) into v_unresolved
  from public.resolve_job_parts(v_job) r
  where not r.resolved or r.line_cost is null;

  if v_unresolved <> 0 then
    raise exception '% of Donna Burgess''s lines do not resolve or have no cost.', v_unresolved;
  end if;

  -- 2. the total is the five parts at their own cost
  select count(*), sum(r.line_cost) into v_lines, v_total
  from public.resolve_job_parts(v_job) r;

  if v_lines <> 5 then
    raise exception 'resolve_job_parts returned % lines, expected 5.', v_lines;
  end if;

  if v_total <> 1669.98 then
    raise exception 'The parts total is %, expected 1669.98.', v_total;
  end if;

  -- 3. the job is costed from these lines, and still reports no profit, because
  --    nobody has been paid to install it yet. no_pay is the right answer here:
  --    it is issue 1's fix saying an unknown payout is not a payout of nothing,
  --    rather than quietly showing $330 of profit on a job with no crew. It
  --    becomes a real profit figure the moment a payout is recorded.
  select profit_basis into v_basis from public.job_margin where id = v_job;

  if v_basis is distinct from 'no_pay' then
    raise exception 'job_margin reads profit_basis %, expected "no_pay" on a job with no payout.', v_basis;
  end if;

  -- and the parts half is costed from these lines rather than from nothing
  select parts_cost_basis into v_basis from public.job_margin where id = v_job;

  if v_basis is distinct from 'expected' then
    raise exception 'job_margin reads parts_cost_basis %, expected "expected".', v_basis;
  end if;

  -- 4. nothing was reserved or deducted: this job has no date
  if exists (select 1 from public.job_reservations where job_id = v_job and released_at is null) then
    raise exception 'Listing parts reserved stock on a job with no scheduled date.';
  end if;

  if exists (select 1 from public.inventory_transactions where job_id = v_job) then
    raise exception 'Listing parts moved the ledger.';
  end if;

  raise notice 'five lines, all costed, total 1669.98, nothing reserved and nothing deducted';
end $$;
