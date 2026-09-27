-- The two tanks Prudhvi's change order took back.
--
-- A signed change order dated Sep 9 replaced the salt free conditioner and
-- the carbon only tank with a mixed bed system. The two removed units became
-- MWP property and are on the shelf. The ledger never heard about it: both
-- SKUs read zero on hand while the units sit in the warehouse, and his job
-- still carries the cost of all three systems.
--
-- Two returns, against his job, because that is where the cost went. A return
-- is a positive quantity, so the shelf gains one of each and job_margin takes
-- the same money back off his parts cost, which is the whole point: he was
-- billed for what he kept, not for what came back.
--
-- Stamped at the cost they were deducted at, which is the honest reversal of
-- the deduction. It does mean the shelf now values two used tanks at what new
-- ones cost, and there is no used SKU to put them on. That is a valuation
-- question for the owner rather than something to guess at here, and it is
-- recorded in the note so whoever prices them knows what they are looking at.
--
-- Inserted, never edited. inventory_transactions is append only and the
-- trigger raises WB023 on anything else.

insert into public.inventory_transactions
  (item_id, quantity, txn_type, job_id, unit_cost_at_txn, reference, note, source)
select
  i.id,
  1,
  'return',
  j.id,
  case i.sku when 'SALTFREE-1054' then 921.12 when 'CARB-ONLY-1054' then 323.20 end,
  j.invoice_number,
  format('Taken back under the signed change order dated Sep 9, which replaced this %s '
    'with a mixed bed system. The unit is MWP property and is on the shelf. Returned at '
    'the cost it was deducted at, so the job is credited what it was charged; it is a '
    'used unit and has no used SKU to be valued on yet.', i.name),
  'manual'
from public.inventory_items i
cross join public.jobs j
where j.customer_name = 'Prudhvi Yalavarthi'
  and i.sku in ('SALTFREE-1054', 'CARB-ONLY-1054');

do $$
declare
  v_salt int;
  v_carb int;
  v_parts numeric;
  v_margin numeric;
begin
  select on_hand into v_salt from public.inventory_stock where sku = 'SALTFREE-1054';
  select on_hand into v_carb from public.inventory_stock where sku = 'CARB-ONLY-1054';
  if v_salt <> 1 or v_carb <> 1 then
    raise exception 'the shelf reads % salt free and % carbon only', v_salt, v_carb;
  end if;

  select parts_cost, margin into v_parts, v_margin
  from public.job_margin where customer_name = 'Prudhvi Yalavarthi';

  -- 2,224.69 less the 1,244.32 that came back.
  if v_parts <> 980.37 then
    raise exception 'his parts cost reads % rather than 980.37', v_parts;
  end if;

  -- 3,949 less 980.37 of parts less 1,355 of pay.
  if v_margin <> 1613.63 then
    raise exception 'his margin reads % rather than 1613.63', v_margin;
  end if;
end $$;

notify pgrst, 'reload schema';
