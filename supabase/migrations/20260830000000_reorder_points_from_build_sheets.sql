-- Reorder points derived from what a job actually consumes.
--
-- They were set by category: every faucet at 3, every RO at 2, every system at
-- 2. That is a guess dressed as a rule, and it made the dashboard useless.
-- Four finishes of the same faucet each flagged at 3 while a job takes exactly
-- one of whichever finish the customer picked, so the shelf could hold eleven
-- faucets across four SKUs and still report four parts needing attention.
--
-- The line that means something is one job's worth. At the reorder point you
-- can still finish the next job; below it you cannot. So:
--
--   a part used once per job    flags at 1
--   salt, two bags per job      flags at 2
--   a part on no build sheet    flags at 1, a floor rather than a derivation,
--                               because zero would mean it never flags at all
--
-- A customer pick line names a category rather than an item, and any active
-- item in that category could be the one chosen, so every candidate has to be
-- able to cover the whole line on its own. That is why four faucet SKUs each
-- get 1 rather than a quarter of one.
--
-- This is a function rather than a list of numbers because build sheets
-- change. Adding a second bag of salt to a sheet should move the reorder
-- point, and it will, the next time this is run.

-- ---------------------------------------------------------------------------
-- what one job takes of each item, worst case across every active build sheet
-- ---------------------------------------------------------------------------
create or replace function public.reorder_points_from_build_sheets()
returns table (
  item_id uuid,
  sku text,
  name text,
  consumed_per_job int,
  current_threshold int,
  suggested int
)
language sql
stable
security invoker
set search_path = public
as $$
  with per_sheet as (
    -- a fixed line names its item outright
    select l.template_id, l.item_id, sum(l.quantity)::int as qty
    from public.template_lines l
    join public.system_templates t on t.id = l.template_id and t.active
    where l.line_type = 'fixed' and l.item_id is not null
    group by l.template_id, l.item_id

    union all

    -- a customer pick line names a category. Any active item in it could be
    -- the one chosen, so each candidate must cover the whole quantity.
    select l.template_id, i.id, sum(l.quantity)::int
    from public.template_lines l
    join public.system_templates t on t.id = l.template_id and t.active
    join public.inventory_items i on i.category = l.pick_category and i.active
    where l.line_type = 'customer_pick' and l.pick_category is not null
    group by l.template_id, i.id
  ),
  per_job as (
    select ps.item_id, max(ps.qty) as worst_case
    from per_sheet ps
    group by ps.item_id
  )
  select
    i.id,
    i.sku,
    i.name,
    coalesce(p.worst_case, 0)::int,
    i.reorder_threshold,
    greatest(1, coalesce(p.worst_case, 0))::int
  from public.inventory_items i
  left join per_job p on p.item_id = i.id
  where i.active
  order by i.category, i.sku;
$$;

comment on function public.reorder_points_from_build_sheets() is
  'What each active item''s reorder point would be if derived from the build '
  'sheets: one job''s worth, floored at 1. Read only, so it can be reviewed '
  'before apply_reorder_points writes it.';

-- ---------------------------------------------------------------------------
-- write them, and report only what actually moved
-- ---------------------------------------------------------------------------
create or replace function public.apply_reorder_points()
returns table (sku text, name text, was int, now_at int)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with proposed as (
    select * from public.reorder_points_from_build_sheets()
  ),
  changed as (
    update public.inventory_items i
    set reorder_threshold = p.suggested
    from proposed p
    where i.id = p.item_id
      and i.reorder_threshold is distinct from p.suggested
    returning i.sku, i.name, p.current_threshold, i.reorder_threshold
  )
  select c.sku, c.name, c.current_threshold, c.reorder_threshold
  from changed c
  order by c.sku;
end;
$$;

comment on function public.apply_reorder_points() is
  'Sets every active item''s reorder point to one job''s worth and returns the '
  'rows that moved. Safe to re-run: unchanged items are not touched.';

grant execute on function public.reorder_points_from_build_sheets() to authenticated;
grant execute on function public.apply_reorder_points() to authenticated;

-- ---------------------------------------------------------------------------
-- apply them now
-- ---------------------------------------------------------------------------
do $$
declare
  moved int;
begin
  select count(*) into moved from public.apply_reorder_points();
  raise notice 'reorder points updated on % item(s)', moved;
end $$;

notify pgrst, 'reload schema';
