-- Bruce Weislik's control valve is a Hankscraft.
--
-- The job was written up with "ceramic valve" in the instruction that created
-- it, and there is no such valve type on the list: the two the build sheets
-- resolve against are Clack and Hankscraft. The GoHighLevel record does not
-- settle it either. His conversation there is three outbound texts and five
-- calls, the calls carry no transcript, and neither the texts nor the
-- opportunity mention a valve at all. So this is Steve's decision rather than
-- a reading of the record, recorded here as one.
--
-- Written as the app writes it, a plain update on the row, so the
-- jobs_sync_reservations trigger re-resolves the parts list and moves the
-- reservations with it. Before this the Valve line named no item, which left
-- the job costed as "partial" and refusing to install.

update public.jobs
set valve_type = 'Hankscraft'
where id = '0943fa0a-7e7b-47db-9a92-2434f709ad17'
  and customer_name = 'Bruce Weislik';

do $$
declare
  v_job uuid := '0943fa0a-7e7b-47db-9a92-2434f709ad17';
  v_unresolved int;
  v_valve int;
  v_basis text;
begin
  if (select valve_type from public.jobs where id = v_job) is distinct from 'Hankscraft' then
    raise exception 'the valve type did not save';
  end if;

  -- Every line on the sheet now names a part, which is what lets the job
  -- install at all.
  select unresolved_lines, parts_cost_basis into v_unresolved, v_basis
  from public.job_margin where id = v_job;
  if v_unresolved <> 0 then
    raise exception '% lines still name no part', v_unresolved;
  end if;
  if v_basis <> 'expected' then
    raise exception 'the parts figure reads % rather than expected', v_basis;
  end if;

  -- And the valve is promised from the shelf like the rest of it.
  select count(*) into v_valve
  from public.job_reservation_lines
  where job_id = v_job and sku = 'VLV-HANK';
  if v_valve <> 1 then
    raise exception 'the Hankscraft valve is not reserved for this job';
  end if;
end $$;
