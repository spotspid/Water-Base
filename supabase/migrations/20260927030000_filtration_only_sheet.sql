-- The sheet that was missing: a carbon tank and an RO, no softener.
--
-- Three jobs were sitting on Custom because nothing described what they are.
-- April Y. Stone's job says so in its own note: "Scope on the agreement is
-- carbon filtration with RO. No build sheet exists for that." Custom is what a
-- job with no matching sheet gets, and a job on Custom has no parts to resolve,
-- no rate line to pay from and the word "Custom" printed on the customer's
-- agreement.
--
-- Four lines, matching what Xhovano Dedaj and the owner's own house carry: the
-- pass through carbon tank, the RO the customer picked, the alkaline filter,
-- and the faucet the customer picked. No valve line, because that tank has its
-- own pass through valve and neither job carries a separate one.
--
-- The rate mapping is a judgment call and is flagged as one. A carbon tank is
-- the same labour as a softener tank with no brine to plumb, so it maps to the
-- softener lines: $400, or $500 where the job also takes an RO. Change it on
-- the sheet if that is wrong; it is two columns, not a rewrite.
--
-- April is deliberately untouched. She installs tomorrow, and moving her sheet
-- would change what her job claims the day before the van loads.

insert into public.system_templates
  (label, long_label, default_price, active, sort_order, rate_key, rate_key_with_ro)
values
  ('Filtration Only', 'Whole home single tank water filtration system',
   null, true, 35, 'softener', 'softener_ro')
on conflict do nothing;

insert into public.template_lines
  (template_id, line_type, item_id, pick_source, pick_category, quantity, sort_order)
select t.id, 'fixed', i.id, null, null, 1, 10
from public.system_templates t, public.inventory_items i
where t.label = 'Filtration Only' and i.sku = 'CARB-ONLY-1054';

insert into public.template_lines
  (template_id, line_type, item_id, pick_source, pick_category, quantity, sort_order)
select t.id, 'customer_pick', null, 'ro_type', 'RO', 1, 20
from public.system_templates t where t.label = 'Filtration Only';

insert into public.template_lines
  (template_id, line_type, item_id, pick_source, pick_category, quantity, sort_order)
select t.id, 'fixed', i.id, null, null, 1, 30
from public.system_templates t, public.inventory_items i
where t.label = 'Filtration Only' and i.sku = 'RO-ALK-FILT';

insert into public.template_lines
  (template_id, line_type, item_id, pick_source, pick_category, quantity, sort_order)
select t.id, 'customer_pick', null, 'faucet_finish', 'Faucet', 1, 40
from public.system_templates t where t.label = 'Filtration Only';

-- Xhovano Dedaj: sold, no date, so his own list goes and the sheet answers.
-- His RO type is already Tank Style. His faucet is deliberately left unset:
-- his own list never carried one, and an RO with no faucet is a real gap that
-- should show as an unresolved line rather than be invented here.
delete from public.job_parts
where job_id = (select id from public.jobs where customer_name = 'Xhovano Dedaj');

update public.jobs j
set template_id = t.id, system_template = t.label
from public.system_templates t
where t.label = 'Filtration Only' and j.customer_name = 'Xhovano Dedaj';

-- The owner's own house: installed on Aug 25, so its parts list stays. The
-- ledger is append only and job_parts_guard refuses to touch the list of a job
-- whose parts are already in it. The list is the record of what was consumed;
-- only the sheet it sits under changes, which is what the documents read.
update public.jobs j
set template_id = t.id, system_template = t.label
from public.system_templates t
where t.label = 'Filtration Only'
  and j.customer_name = 'Steve Burgess'
  and j.address like '9598 Mercedes%';

-- David Camaj: a Well Water Bundle written up on Custom. His own list is that
-- sheet, line for line, so the picks are read off the parts he already carries
-- rather than guessed: the tank style RO, the chrome faucet, the Clack valve.
update public.jobs
set ro_type = 'Tank Style', faucet_finish = 'Chrome', valve_type = 'Clack'
where customer_name = 'David Camaj';

delete from public.job_parts
where job_id = (select id from public.jobs where customer_name = 'David Camaj');

update public.jobs j
set template_id = t.id, system_template = t.label
from public.system_templates t
where t.label = 'Well Water Bundle' and j.customer_name = 'David Camaj';

do $$
declare
  v_lines int;
  v_unresolved int;
  v_april record;
begin
  select count(*) into v_lines
  from public.template_lines l
  join public.system_templates t on t.id = l.template_id
  where t.label = 'Filtration Only';
  if v_lines <> 4 then
    raise exception 'the sheet has % lines rather than 4', v_lines;
  end if;

  -- David resolves to the whole Well Water Bundle, nothing outstanding.
  select unresolved_lines into v_unresolved
  from public.job_margin where customer_name = 'David Camaj';
  if v_unresolved <> 0 then
    raise exception 'David Camaj has % lines that name no part', v_unresolved;
  end if;

  -- Xhovano is short exactly one: the faucet nobody has chosen.
  select unresolved_lines into v_unresolved
  from public.job_margin where customer_name = 'Xhovano Dedaj';
  if v_unresolved <> 1 then
    raise exception 'Xhovano Dedaj has % unresolved lines rather than the faucet', v_unresolved;
  end if;

  -- April is exactly as she was.
  select system_template, has_job_parts, parts_cost_effective
    into v_april
  from public.job_margin where customer_name = 'April Y. Stone';
  if v_april.system_template <> 'Custom'
     or not v_april.has_job_parts
     or v_april.parts_cost_effective <> 748.86 then
    raise exception 'April Y. Stone moved: % / % / %',
      v_april.system_template, v_april.has_job_parts, v_april.parts_cost_effective;
  end if;
end $$;

notify pgrst, 'reload schema';
