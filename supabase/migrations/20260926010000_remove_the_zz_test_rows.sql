-- ---------------------------------------------------------------------------
-- The ZZ Test jobs and the ZZ Test installer, removed.
--
-- Two jobs were written to exercise the app: "ZZ Test - Steve Burgess", which
-- held a scheduled date, six reserved parts and two DocuSeal sends to Steve's
-- own address, and "ZZ Test - Sept 17 quote". Neither is real work. They count
-- toward the quotes list, hold parts real jobs need, and one of them was
-- reserving salt and a chrome faucet that Glen Hooker and Bruce Weislik are
-- short of.
--
-- Deleting a job is otherwise not something this app does, and it is only safe
-- here because neither has ever touched stock. The guard below refuses if
-- either has a single ledger row: inventory_transactions.job_id is ON DELETE
-- SET NULL, and the ledger is append only, so the delete would be refused by
-- the append only trigger anyway. Better to say why first.
--
-- What goes with each job, by cascade: its agreement rows and any kept
-- history, its payments, its own parts list, its reservations and its
-- notification log. The DocuSeal submissions themselves are untouched and stay
-- in that account; they are test sends on the template documents and the
-- Documents page already leaves them out of its gap scan.
--
-- "Quote E2E - Steve Burgess" is deliberately left alone. It is flagged as a
-- test but carries a signed customer agreement, so it is somebody's end to end
-- proof rather than a scratch row, and it was not named.
-- ---------------------------------------------------------------------------
do $remove$
declare
  v_names constant text[] := array['ZZ Test - Steve Burgess', 'ZZ Test - Sept 17 quote'];
  v_installer constant text := 'ZZ Test Installer';
  v_jobs uuid[];
  v_id uuid;
  v_rows int;
  v_left int;
begin
  select array_agg(id) into v_jobs from public.jobs where customer_name = any(v_names);

  if v_jobs is null or array_length(v_jobs, 1) <> 2 then
    raise exception 'Expected the two ZZ Test jobs, found %. Stopping.', coalesce(array_length(v_jobs, 1), 0);
  end if;

  -- a job that ever moved stock is a record, not a scratch row
  if exists (
    select 1 from public.inventory_transactions t
    where t.job_id = any(v_jobs) or t.warranty_job_id = any(v_jobs)
  ) then
    raise exception 'One of the ZZ Test jobs has stock history, which is append only and cannot be unpicked. Cancel it instead.';
  end if;

  foreach v_id in array v_jobs loop
    delete from public.jobs where id = v_id;

    get diagnostics v_rows = row_count;

    if v_rows <> 1 then
      raise exception 'Deleting job % removed % rows, expected 1.', v_id, v_rows;
    end if;
  end loop;

  -- The roster refuses to drop anyone a job still points at, so this can only
  -- run once those two are gone.
  select count(*) into v_left
  from public.jobs j
  join public.installers i on i.id = j.installer_id or i.id = j.helper_id
  where i.name = v_installer;

  if v_left > 0 then
    raise exception '% is still the crew on % job(s), so the roster will not let it go.', v_installer, v_left;
  end if;

  delete from public.installers where name = v_installer;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Removing % deleted % rows, expected 1.', v_installer, v_rows;
  end if;

  if exists (select 1 from public.jobs where customer_name = any(v_names))
     or exists (select 1 from public.installers where name = v_installer) then
    raise exception 'Something survived the removal.';
  end if;
end;
$remove$;
