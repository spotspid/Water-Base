-- Point the orders at the suppliers, and keep the name true.
--
-- Split out of 20261009120000 because every statement here writes to rows that
-- already exist: it fills supplier_id on live orders, and it adds two triggers
-- that rewrite supplier_orders.supplier. The tables themselves were additive
-- and went straight to production; this half is proved on a branch first.
--
-- supplier_orders.supplier stays as the display name rather than being dropped.
-- Several views and functions read that column today, and rewriting all of
-- them in the same change that introduces the link multiplies the ways this
-- can go wrong. The text becomes derived rather than authored, and can be
-- dropped once nothing reads it.

insert into public.suppliers (name)
select distinct btrim(o.supplier)
from public.supplier_orders o
where btrim(coalesce(o.supplier, '')) <> ''
  and not exists (
    select 1 from public.suppliers s
    where lower(s.name) = lower(btrim(o.supplier)))
on conflict do nothing;

update public.supplier_orders o
set supplier_id = s.id
from public.suppliers s
where o.supplier_id is null
  and lower(btrim(coalesce(o.supplier, ''))) = lower(s.name);

-- Keep the display name true to the link, in both directions: setting
-- supplier_id fills the name, and a renamed supplier updates its orders.
create or replace function public.supplier_orders_sync_name()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name text;
begin
  if new.supplier_id is not null then
    select name into v_name from public.suppliers where id = new.supplier_id;

    if v_name is not null then
      new.supplier := v_name;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists supplier_orders_sync_name on public.supplier_orders;

create trigger supplier_orders_sync_name
before insert or update of supplier_id on public.supplier_orders
for each row execute function public.supplier_orders_sync_name();

create or replace function public.suppliers_rename_orders()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.name is distinct from old.name then
    update public.supplier_orders set supplier = new.name where supplier_id = new.id;
  end if;

  return new;
end;
$function$;

drop trigger if exists suppliers_rename_orders on public.suppliers;

create trigger suppliers_rename_orders
after update of name on public.suppliers
for each row execute function public.suppliers_rename_orders();


notify pgrst, 'reload schema';

-- Proof.
do $$
declare
  v_orphan int;
  v_order  uuid;
  v_name   text;
begin
  -- 1. every order that had a supplier name now points at a supplier row
  select count(*) into v_orphan
  from public.supplier_orders
  where btrim(coalesce(supplier, '')) <> '' and supplier_id is null;

  if v_orphan <> 0 then
    raise exception '% orders still have a supplier name and no supplier row.', v_orphan;
  end if;

  -- 2. renaming a supplier renames it on its orders
  select id into v_order from public.supplier_orders where supplier_id is not null limit 1;

  if v_order is not null then
    select s.name into v_name
    from public.suppliers s join public.supplier_orders o on o.supplier_id = s.id
    where o.id = v_order;

    update public.suppliers set name = v_name || ' (proof)' where name = v_name;

    if (select supplier from public.supplier_orders where id = v_order) <> v_name || ' (proof)' then
      raise exception 'Renaming a supplier did not rename it on its orders.';
    end if;

    update public.suppliers set name = v_name where name = v_name || ' (proof)';

    if (select supplier from public.supplier_orders where id = v_order) <> v_name then
      raise exception 'The supplier name was not put back.';
    end if;
  end if;

  raise notice 'orders point at suppliers, and a rename follows through';
end $$;
