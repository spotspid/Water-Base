-- The ledger is append only, and the database now says so.
--
-- inventory_transactions has always been described as a ledger where every
-- stock change is a new row and nothing is overwritten. That was a promise
-- the policies did not keep: any signed in user could update or delete a row,
-- and the audit deleted a purchase and watched a shelf go from five to nothing
-- with no error. Nothing legitimate updates or deletes a ledger row. Installs
-- insert, reversals insert returns, receipts insert purchases, warranty
-- replacements insert. So the update and delete policies go, and a trigger
-- refuses both for anything that bypasses row level security as well.
--
-- One consequence worth naming: job_id and warranty_job_id set themselves
-- null when their job is deleted, and that is an update on the ledger row,
-- so a job with ledger history can no longer be deleted. That is right. The
-- app has no delete for jobs, and a job that consumed parts is history;
-- cancelling is the way to close one that did not happen.
--
-- The same audit deleted a supplier order line that had already been
-- received. The purchase rows stayed in the ledger and the order forgot the
-- units, so stock and the order disagreed. The Remove button already hides
-- once anything has landed; now the table refuses too.

-- ---------------------------------------------------------------------------
-- the ledger
-- ---------------------------------------------------------------------------
drop policy if exists "inventory_transactions_update" on public.inventory_transactions;
drop policy if exists "inventory_transactions_delete" on public.inventory_transactions;

create or replace function public.inventory_transactions_append_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  raise exception 'The inventory ledger is append only. A movement is corrected by logging another one, never by changing or removing a row.'
    using errcode = 'WB023';
end;
$fn$;

drop trigger if exists inventory_transactions_append_only on public.inventory_transactions;
create trigger inventory_transactions_append_only
  before update or delete on public.inventory_transactions
  for each row execute function public.inventory_transactions_append_only();

-- ---------------------------------------------------------------------------
-- a received line stays
-- ---------------------------------------------------------------------------
create or replace function public.supplier_order_lines_keep_received()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  if coalesce(old.quantity_received, 0) > 0 then
    raise exception '% of this line % already received and in the ledger, so the line cannot be removed. Receive the rest or leave it as it is.',
      old.quantity_received,
      case when old.quantity_received = 1 then 'is' else 'are' end
      using errcode = 'WB024';
  end if;

  return old;
end;
$fn$;

drop trigger if exists supplier_order_lines_keep_received on public.supplier_order_lines;
create trigger supplier_order_lines_keep_received
  before delete on public.supplier_order_lines
  for each row execute function public.supplier_order_lines_keep_received();

-- ---------------------------------------------------------------------------
-- prove it
-- ---------------------------------------------------------------------------
do $$
declare
  v_txn     uuid;
  v_line    uuid;
  v_open    uuid;
  v_refused boolean;
  v_state   text;
begin
  if exists (
    select 1 from pg_policies
    where tablename = 'inventory_transactions' and policyname in
      ('inventory_transactions_update', 'inventory_transactions_delete')
  ) then
    raise exception 'the ledger update or delete policy is still there';
  end if;

  select id into v_txn from public.inventory_transactions order by created_at limit 1;

  if v_txn is not null then
    v_refused := false;
    begin
      update public.inventory_transactions set note = 'changed' where id = v_txn;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      v_refused := v_state = 'WB023';
    end;
    if not v_refused then raise exception 'a ledger row could be updated'; end if;

    v_refused := false;
    begin
      delete from public.inventory_transactions where id = v_txn;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      v_refused := v_state = 'WB023';
    end;
    if not v_refused then raise exception 'a ledger row could be deleted'; end if;
  end if;

  select id into v_line from public.supplier_order_lines where quantity_received > 0 limit 1;

  if v_line is not null then
    v_refused := false;
    begin
      delete from public.supplier_order_lines where id = v_line;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      v_refused := v_state = 'WB024';
    end;
    if not v_refused then raise exception 'a received order line could be deleted'; end if;
  end if;

  -- and a line with nothing received still can be, which the order form relies on
  select id into v_open from public.supplier_order_lines where coalesce(quantity_received, 0) = 0 limit 1;

  if v_open is not null then
    begin
      delete from public.supplier_order_lines where id = v_open;
      raise exception 'PROOF_ROLLBACK';
    exception when others then
      if sqlerrm <> 'PROOF_ROLLBACK' then raise; end if;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';
