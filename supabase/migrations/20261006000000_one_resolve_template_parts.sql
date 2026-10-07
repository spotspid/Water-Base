-- One resolve_template_parts again.
--
-- A carbon type pick was added on the live database as a second overload,
-- resolve_template_parts(uuid, text, text, text, text), beside the original
-- (uuid, text, text, text). Every argument after the first has a default, so
-- a four-argument call matches both and Postgres refuses it as "not unique".
-- Every caller passes four: the parts check, the reservations a date claims,
-- the work order send and the install deduction. So none of them worked, and
-- the schedule modal reported it as "Parts availability could not be
-- checked", which David read as being out of stock.
--
-- The five-argument version is kept, because it is a superset: with no carbon
-- type it resolves exactly what the original did. Its line_cost had gone back
-- to coalescing a missing cost to zero, which 20260926020000 deliberately
-- stopped, so it is re-declared with that fix. The original is renamed out
-- of the way rather than dropped, and nobody can call it, so it can be
-- removed later once nothing turns out to want it.

alter function public.resolve_template_parts(uuid, text, text, text)
  rename to resolve_template_parts_superseded_20261006;

revoke execute on function public.resolve_template_parts_superseded_20261006(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.resolve_template_parts(
  p_template_id uuid,
  p_faucet_finish text default null,
  p_ro_type text default null,
  p_valve_type text default null,
  p_carbon_type text default null
)
returns table(
  line_id uuid, line_type text, pick_source text, pick_category text,
  quantity integer, item_id uuid, sku text, item_name text, item_variant text,
  unit_cost numeric, line_cost numeric, resolved boolean, sort_order integer
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select
    tl.id,
    tl.line_type,
    tl.pick_source,
    tl.pick_category,
    tl.quantity,
    coalesce(tl.item_id, pick.id),
    coalesce(fixed_item.sku, pick.sku),
    coalesce(fixed_item.name, pick.name),
    coalesce(fixed_item.variant, pick.variant),
    coalesce(fixed_item.unit_cost, pick.unit_cost),
    (tl.quantity * coalesce(fixed_item.unit_cost, pick.unit_cost))::numeric(10,2),
    coalesce(tl.item_id, pick.id) is not null,
    tl.sort_order
  from public.template_lines tl
  left join public.inventory_items fixed_item on fixed_item.id = tl.item_id
  left join lateral (
    select i.id, i.sku, i.name, i.variant, i.unit_cost
    from public.inventory_items i
    where tl.line_type = 'customer_pick'
      and i.category = tl.pick_category
      and i.active
      and i.variant = case tl.pick_source
                        when 'faucet_finish' then p_faucet_finish
                        when 'ro_type'       then p_ro_type
                        when 'valve_type'    then p_valve_type
                        when 'carbon_type'   then p_carbon_type
                      end
    order by i.created_at, i.id
    limit 1
  ) pick on true
  where tl.template_id = p_template_id
    and not (
      coalesce(p_ro_type, '') = 'No RO'
      and (
        coalesce(tl.pick_source, '') in ('ro_type', 'faucet_finish')
        or (tl.line_type = 'fixed' and coalesce(fixed_item.category, '') = 'RO')
      )
    )
  order by tl.sort_order, tl.id
$function$;

grant execute on function public.resolve_template_parts(uuid, text, text, text, text) to authenticated;
revoke execute on function public.resolve_template_parts(uuid, text, text, text, text) from public, anon;

-- Proof: one definition, and a four-argument call resolves.
do $$
declare
  v_count int;
  v_template uuid;
begin
  select count(*) into v_count from pg_proc where proname = 'resolve_template_parts';
  if v_count <> 1 then
    raise exception 'resolve_template_parts has % definitions, not 1', v_count;
  end if;

  select template_id into v_template from public.template_lines limit 1;
  perform * from public.resolve_template_parts(v_template, null::text, null::text, null::text);
end $$;

notify pgrst, 'reload schema';
