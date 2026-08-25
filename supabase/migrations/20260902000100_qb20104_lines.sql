-- The lines on QB-20104, the Honest invoice dated 17 August 2026.
--
-- The header was seeded when supplier orders were built, deliberately without
-- lines, so that entering them would exercise the flow rather than prove
-- nothing. These are being loaded here because there are twenty of them and
-- fourteen need a catalogue entry first, which is a data job rather than a
-- test of the form.
--
-- 9,803.00 of lines against 758.05 of freight makes the 10,561.05 total on the
-- invoice. Nothing is received: this is stock that has been bought and is not
-- here, which is the whole point of the on order figure.
--
-- No expected arrival. Honest do not give one, so the field stays null rather
-- than carrying a guess. A shortage on any of these will read "on order, no
-- date", which is honest, instead of naming a day nobody promised.
--
-- New items are created at the invoice unit price, not the landed price. They
-- are not on the shelf yet, and landed cost is what a part is worth once it is
-- standing in the unit. Receiving raises each one to its landed figure, which
-- is the moment the catalogue should start claiming freight was paid.

-- ---------------------------------------------------------------------------
-- the fourteen parts that had no catalogue entry
--
-- Categories come from the list already in settings. Filter and Valve were
-- seeded there and unused until now, which is what they were seeded for.
--
-- Nothing here carries a variant. Variant is what the customer pick lines
-- match on, so a null one cannot be selected as somebody's faucet finish or RO
-- type by accident, which matters for the circuit board sitting in the RO
-- category next to the units it belongs to.
-- ---------------------------------------------------------------------------
insert into public.inventory_items (sku, name, category, unit_cost, reorder_threshold, notes)
values
  ('WELL-AIO-DUAL',  'Dual Tank Well Iron Breaker AIO',              'System',   1330.00, 1, null),
  ('SALTFREE-1054',  '10x54 Salt Free Conditioner',                  'System',    855.00, 1, null),
  ('CARB-ONLY-1054', 'Carbon Only Tank, no resin, with pass thru valve', 'System', 300.00, 1,
     'Kept separate from CARB-CAT-1054 on purpose. That one is catalytic at '
     'roughly 400 and this one is 300 with a pass thru valve, and nobody has '
     'confirmed whether they are the same product under two part numbers. '
     'Merge them only once someone has checked.'),
  ('VLV-HEAD',       'Valve head, complete box',                     'Valve',     225.00, 1, null),
  ('RO-TL-PCB',      'Tankless RO circuit board',                    'RO',         20.00, 1, null),
  ('RO-TL-CB-ALK',   'Tankless RO cartridge, alkaline',              'Filter',     18.00, 1, null),
  ('RO-TL-CB-NRM',   'Tankless RO cartridge, normal',                'Filter',     16.00, 1, null),
  ('RO-10-PP',       'RO 10 inch PP filter',                         'Filter',      1.00, 1, null),
  ('RO-10-UDF',      'RO 10 inch UDF filter',                        'Filter',      3.00, 1, null),
  ('RO-10-CTO',      'RO 10 inch CTO filter',                        'Filter',      3.00, 1, null),
  ('RO-MEM-100',     'RO 100 GPD low pressure membrane',             'Filter',     12.00, 1, null),
  ('RO-T33',         'RO T33 post filter',                           'Filter',      3.00, 1, null),
  ('FILT-20-BLUE',   '20 inch blue filter housing',                  'Filter',     11.00, 1, null),
  ('FILT-20-PP',     '20 inch PP filter',                            'Filter',      1.00, 1, null)
on conflict (sku) do nothing;

-- The existing catalytic tank gains the other half of the note, so whichever
-- one somebody opens, the question is in front of them.
update public.inventory_items
set notes = trim(coalesce(notes || ' ', '')
  || 'Kept separate from CARB-ONLY-1054 on purpose. This one is catalytic; '
  || 'that one is 300 with a pass thru valve. Nobody has confirmed whether '
  || 'they are the same product under two part numbers.')
where sku = 'CARB-CAT-1054'
  and coalesce(notes, '') not like '%CARB-ONLY-1054%';

-- ---------------------------------------------------------------------------
-- the twenty lines
--
-- Prices are as invoiced, before freight. Landed cost is derived by
-- supplier_order_lines_costed, so nothing here has freight baked into it.
-- ---------------------------------------------------------------------------
insert into public.supplier_order_lines (order_id, item_id, quantity_ordered, unit_cost)
select o.id, i.id, v.qty, v.price
from public.supplier_orders o
cross join (values
  ('MB-1054',        3,  665.00),
  ('WELL-AIO-DUAL',  4, 1330.00),
  ('RO-TANK-5ST',    4,  200.00),
  ('RO-TL-PCB',      1,   20.00),
  ('RO-TL-CB-ALK',   1,   18.00),
  ('RO-TL-CB-NRM',   1,   16.00),
  ('RO-10-PP',       1,    1.00),
  ('RO-10-UDF',      1,    3.00),
  ('RO-10-CTO',      1,    3.00),
  ('RO-MEM-100',     1,   12.00),
  ('RO-T33',         1,    3.00),
  ('FILT-20-BLUE',   1,   11.00),
  ('FILT-20-PP',     1,    1.00),
  ('RO-ALK-FILT',    4,   25.00),
  ('FCT-NICKEL',     2,   20.00),
  ('FCT-BLACK',      2,   20.00),
  ('FCT-CHROME',     2,   20.00),
  ('VLV-HEAD',       1,  225.00),
  ('SALTFREE-1054',  1,  855.00),
  ('CARB-ONLY-1054', 1,  300.00)
) as v(sku, qty, price)
join public.inventory_items i on i.sku = v.sku
where o.order_number = 'QB-20104'
  and not exists (
    select 1 from public.supplier_order_lines l
    where l.order_id = o.id and l.item_id = i.id
  );

-- ---------------------------------------------------------------------------
-- reorder points, derived the same way the existing ones were
--
-- One job's worth, floored at 1. Every new part here is on no build sheet, so
-- every one lands on the floor. That is the honest answer rather than a guess:
-- a part nothing consumes has no consumption to derive from, and 1 at least
-- means the shelf speaks up before it is empty. Put any of them on a build
-- sheet and re-running this moves the number with it.
-- ---------------------------------------------------------------------------
select public.apply_reorder_points();

-- ---------------------------------------------------------------------------
-- the invoice has to add up, or none of the above is worth having
-- ---------------------------------------------------------------------------
do $$
declare
  v_lines    int;
  v_subtotal numeric(12,2);
  v_balance  numeric(12,2);
  v_received int;
begin
  select line_count, subtotal, entry_balance, units_received
  into v_lines, v_subtotal, v_balance, v_received
  from public.supplier_order_summary
  where order_number = 'QB-20104';

  if v_lines <> 20 then
    raise exception 'QB-20104 should carry 20 lines, not %', v_lines;
  end if;

  if v_subtotal <> 9803.00 then
    raise exception 'QB-20104 lines sum to % rather than 9803.00', v_subtotal;
  end if;

  if v_balance <> 0 then
    raise exception 'QB-20104 is % away from its invoice total', v_balance;
  end if;

  if v_received <> 0 then
    raise exception 'QB-20104 should have nothing received, found %', v_received;
  end if;

  raise notice 'QB-20104: 20 lines, 9803.00 plus 758.05 freight, balance zero, nothing received';
end $$;

notify pgrst, 'reload schema';
