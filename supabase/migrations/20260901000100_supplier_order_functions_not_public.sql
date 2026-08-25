-- Three of the supplier order functions are security definer and were left
-- callable over the REST API, including by anon.
--
-- Two are trigger functions that nothing should ever call directly, and the
-- third writes an order's status from a uuid, which is not something an
-- unauthenticated caller has any business doing. Supabase exposes every
-- function in the public schema at /rest/v1/rpc, so a function being internal
-- by intention is not the same as it being internal in fact.
--
-- PostgreSQL checks EXECUTE on a trigger function when the trigger is created
-- rather than every time it fires, so the triggers keep working with no grant
-- at all. Verified by receiving against an order after applying this.

revoke execute on function public.recompute_order_status(uuid)
  from public, anon, authenticated;

revoke execute on function public.supplier_order_lines_sync_status()
  from public, anon, authenticated;

revoke execute on function public.supplier_orders_announce_arrival()
  from public, anon, authenticated;

-- supplier_touch is the updated_at trigger and was never security definer, but
-- it is equally not something to expose.
revoke execute on function public.supplier_touch()
  from public, anon, authenticated;
