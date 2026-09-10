-- Editing a build sheet updates the claims of every job booked on it.
--
-- A booked job claims the parts its sheet names, and the claim was computed
-- when the job was scheduled. Change the sheet afterwards and nothing
-- recomputed: add a line and no job claimed it, double a quantity and the
-- shelf still showed the old figure, delete a line and the claim stayed. The
-- install itself was always right, because it deducts from the sheet as it
-- is on the day, but between the edit and the install the committed and
-- available figures were wrong for every open job on that sheet.
--
-- One statement level trigger per event, so a statement that touches many
-- lines resyncs each affected job once rather than once per line. Only open
-- jobs with a date are resynced: installed and cancelled jobs hold nothing,
-- and a job without a date claims nothing by rule.
--
-- No false shortage. sync_job_reservations releases what the sheet no longer
-- wants and upserts what it does in one statement, updating an existing
-- claim's quantity in place rather than dropping and recreating it, and all
-- of it commits with the edit. Nobody reading the shelf sees a moment with
-- the claim missing. A sheet that now needs more than the shelf has will show
-- a shortage, and that is the truth rather than a glitch.
--
-- The resync raises if a job cannot be synced, which fails the edit. The one
-- case that can raise, a job naming a sheet it is not linked to, cannot occur
-- here because the jobs are found by template_id.

create or replace function public.template_lines_resync_bookings()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_job    uuid;
  v_sheets uuid[];
begin
  -- the sheets this statement touched. An update may move a line between
  -- sheets, so both sides count. Each branch names only the transition
  -- table its event provides.
  if tg_op = 'INSERT' then
    select array_agg(distinct template_id) into v_sheets from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct template_id) into v_sheets from old_rows;
  else
    select array_agg(distinct t.template_id) into v_sheets
    from (select template_id from new_rows union select template_id from old_rows) t;
  end if;

  if v_sheets is null then
    return null;
  end if;

  for v_job in
    select j.id
    from public.jobs j
    where j.template_id = any(v_sheets)
      and j.status not in ('installed', 'cancelled')
      and j.parts_deducted_at is null
      and j.scheduled_date is not null
    order by j.scheduled_date, j.id
  loop
    perform public.sync_job_reservations(v_job);
  end loop;

  return null;
end;
$fn$;

drop trigger if exists template_lines_resync_on_insert on public.template_lines;
create trigger template_lines_resync_on_insert
  after insert on public.template_lines
  referencing new table as new_rows
  for each statement execute function public.template_lines_resync_bookings();

drop trigger if exists template_lines_resync_on_update on public.template_lines;
create trigger template_lines_resync_on_update
  after update on public.template_lines
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.template_lines_resync_bookings();

drop trigger if exists template_lines_resync_on_delete on public.template_lines;
create trigger template_lines_resync_on_delete
  after delete on public.template_lines
  referencing old table as old_rows
  for each statement execute function public.template_lines_resync_bookings();

-- ---------------------------------------------------------------------------
-- prove it, inside a block that rolls back
--
-- A sheet with an open booking gets a line added, its quantity changed, and
-- the line removed. The booking's claims must follow each step, and the
-- quantity change must update the same claim row rather than replace it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sheet   uuid;
  v_job     uuid;
  v_item    uuid;
  v_line    uuid;
  v_claim   uuid;
  v_again   uuid;
  v_qty     int;
begin
  select j.template_id, j.id into v_sheet, v_job
  from public.jobs j
  where j.status = 'scheduled' and j.parts_deducted_at is null
    and j.scheduled_date is not null and j.template_id is not null
  order by j.scheduled_date
  limit 1;

  if v_sheet is null then
    return;
  end if;

  -- an item not already on that sheet
  select i.id into v_item
  from public.inventory_items i
  where i.active
    and not exists (select 1 from public.template_lines l where l.template_id = v_sheet and l.item_id = i.id)
  order by i.created_at
  limit 1;

  if v_item is null then
    return;
  end if;

  begin
    insert into public.template_lines (template_id, line_type, item_id, quantity, sort_order)
    values (v_sheet, 'fixed', v_item, 1, 990)
    returning id into v_line;

    select id, quantity into v_claim, v_qty
    from public.job_reservations
    where job_id = v_job and item_id = v_item and released_at is null;

    if v_claim is null or v_qty <> 1 then
      raise exception 'adding a line did not claim it for the booked job';
    end if;

    update public.template_lines set quantity = 3 where id = v_line;

    select id, quantity into v_again, v_qty
    from public.job_reservations
    where job_id = v_job and item_id = v_item and released_at is null;

    if v_again is distinct from v_claim then
      raise exception 'a quantity change replaced the claim instead of updating it';
    end if;
    if v_qty <> 3 then
      raise exception 'a quantity change left the claim at % rather than 3', v_qty;
    end if;

    delete from public.template_lines where id = v_line;

    if exists (
      select 1 from public.job_reservations
      where job_id = v_job and item_id = v_item and released_at is null
    ) then
      raise exception 'deleting a line left its claim open';
    end if;

    raise exception 'PROOF_ROLLBACK';
  exception
    when others then
      if sqlerrm <> 'PROOF_ROLLBACK' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
