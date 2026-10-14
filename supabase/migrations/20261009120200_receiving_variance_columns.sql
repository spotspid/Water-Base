-- What actually came off the truck, as columns.
--
-- Additive only: new columns on supplier_order_lines, all defaulted, nothing
-- existing read or rewritten. The behaviour that uses them, which means
-- replacing the costed view, recompute_order_status and receive_order_line,
-- is 20261009120300 and goes to a branch first.
--
-- A shipment can go wrong five ways and the app records one of them. These
-- columns cover the other four:
--
--   short closed    some never arrived and never will. Today the line stays
--                   outstanding for good: one Dual Tank Well Iron Breaker on
--                   QB-20104 has been outstanding since 17 August.
--   over            more arrived than was ordered. Today a CHECK refuses it,
--                   so the extra cannot be put on the shelf at all.
--   substituted     a different part arrived. Today there is nowhere to say so,
--                   and the honest move of booking in what really came would
--                   leave the ordered line outstanding for ever.
--   refused         damaged or wrong and sent back. Never enters stock, so it
--                   is not a ledger row, but it is a fact about the line.
--
-- Quantities rather than flags, because two of three can arrive, one of them
-- can be damaged, and the rest can be cancelled. A flag cannot say that.

alter table public.supplier_order_lines
  add column if not exists quantity_short_closed integer not null default 0,
  add column if not exists short_reason          text,
  add column if not exists short_note            text,
  add column if not exists closed_short_at       timestamptz,
  add column if not exists substituted_item_id   uuid references public.inventory_items (id),
  add column if not exists quantity_refused      integer not null default 0,
  add column if not exists refused_reason        text,
  add column if not exists refused_note          text;

-- The preset reasons. Free text lives in short_note beside whichever is picked,
-- so a reason can be both countable and explained.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_order_lines_short_reason_known') then
    alter table public.supplier_order_lines
      add constraint supplier_order_lines_short_reason_known
      check (short_reason is null or short_reason in (
        'supplier_shorted', 'cancelled_by_supplier', 'damaged_in_transit',
        'substituted', 'other'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_order_lines_refused_reason_known') then
    alter table public.supplier_order_lines
      add constraint supplier_order_lines_refused_reason_known
      check (refused_reason is null or refused_reason in (
        'damaged_in_transit', 'wrong_item', 'quality', 'other'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_order_lines_short_closed_sane') then
    alter table public.supplier_order_lines
      add constraint supplier_order_lines_short_closed_sane
      check (quantity_short_closed >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_order_lines_refused_sane') then
    alter table public.supplier_order_lines
      add constraint supplier_order_lines_refused_sane
      check (quantity_refused >= 0);
  end if;

  -- A closed line says why. Without this a line can be closed with no reason
  -- recorded, which is the same silence the columns exist to end.
  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_order_lines_short_has_reason') then
    alter table public.supplier_order_lines
      add constraint supplier_order_lines_short_has_reason
      check (quantity_short_closed = 0 or short_reason is not null);
  end if;
end $$;

comment on column public.supplier_order_lines.quantity_short_closed is
  'Units that never arrived and are not coming. Stops counting as outstanding.';
comment on column public.supplier_order_lines.substituted_item_id is
  'What actually turned up when a different part was sent. The ledger row is '
  'written against this item, never against the one that was ordered.';
comment on column public.supplier_order_lines.quantity_refused is
  'Units sent back on arrival. Never entered stock, so there is no ledger row: '
  'a refusal is a fact about the delivery, not a movement of stock.';

notify pgrst, 'reload schema';

-- Proof.
do $$
declare
  v_line uuid;
  v_msg  text;
begin
  -- 1. the columns exist and every existing line reads zero, not null
  if exists (
    select 1 from public.supplier_order_lines
    where quantity_short_closed is null or quantity_refused is null) then
    raise exception 'A line has a null variance quantity. The defaults did not apply.';
  end if;

  -- 2. nothing existing moved: ordered and received are untouched by this
  if exists (
    select 1 from public.supplier_order_lines
    where quantity_received > quantity_ordered) then
    raise notice 'A line is already over received. That is expected only after 20261009120300.';
  end if;

  -- 3. a closed line cannot be silent about why
  select id into v_line from public.supplier_order_lines limit 1;

  if v_line is not null then
    begin
      update public.supplier_order_lines
      set quantity_short_closed = 1
      where id = v_line;

      raise exception 'A line was closed short with no reason given.';
    exception
      when check_violation then
        raise notice 'closing a line short demands a reason';
    end;
  end if;

  raise notice 'variance columns added, defaults applied, nothing existing changed';
end $$;
