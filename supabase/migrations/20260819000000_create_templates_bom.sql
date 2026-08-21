-- bill of materials: system templates, template lines, auto deduct, job margin.
--
-- architecture rules carried over from the inventory module:
--   on hand is never stored. it is always summed from inventory_transactions.
--   parts cost is never stored either. it is summed from the same ledger using
--   unit_cost_at_txn, so editing an item's cost later cannot retroactively
--   rewrite the margin on a job that already installed.

-- ---------------------------------------------------------------------------
-- system_templates: one row per sellable system, seeded from the array that
-- used to live in src/lib/constants.js as SYSTEM_TEMPLATES.
-- ---------------------------------------------------------------------------
create table if not exists public.system_templates (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  label          text unique not null,
  default_price  numeric(10,2),
  active         boolean not null default true,
  sort_order     int not null default 0,
  notes          text
);

-- ---------------------------------------------------------------------------
-- template_lines: the parts list for a template.
--
-- a fixed line names an inventory item outright.
-- a customer pick line names a category plus the job field that carries the
-- customer choice, for example faucet_finish. it resolves to a concrete item
-- from the job rather than from the template, so one template covers every
-- faucet finish instead of five near duplicate templates.
-- ---------------------------------------------------------------------------
create table if not exists public.template_lines (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  template_id    uuid not null references public.system_templates(id) on delete cascade,
  line_type      text not null default 'fixed' check (line_type in ('fixed', 'customer_pick')),
  item_id        uuid references public.inventory_items(id) on delete restrict,
  pick_source    text check (pick_source in ('faucet_finish')),
  pick_category  text,
  quantity       int not null check (quantity > 0),
  sort_order     int not null default 0,
  note           text,
  constraint template_lines_shape check (
    (line_type = 'fixed'
       and item_id is not null
       and pick_source is null
       and pick_category is null)
    or
    (line_type = 'customer_pick'
       and item_id is null
       and pick_source is not null
       and pick_category is not null)
  )
);

-- one line per item per template. quantity is the place to say "two of these".
create unique index if not exists template_lines_fixed_item_uniq
  on public.template_lines (template_id, item_id)
  where line_type = 'fixed';

-- one pick line per source per template. two faucet lines would double deduct.
create unique index if not exists template_lines_pick_source_uniq
  on public.template_lines (template_id, pick_source)
  where line_type = 'customer_pick';

create index if not exists template_lines_template_id_idx
  on public.template_lines (template_id, sort_order);

-- ---------------------------------------------------------------------------
-- ledger columns that make an auto deduction identifiable and reversible.
--   source        manual, template, or template_reversal
--   deduct_batch  which deduction run the row belongs to, so a job can be
--                 installed, reversed, and installed again without ambiguity
-- ---------------------------------------------------------------------------
alter table public.inventory_transactions
  add column if not exists source text not null default 'manual';

alter table public.inventory_transactions
  add column if not exists deduct_batch int;

do $checks$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_transactions_source_check'
  ) then
    alter table public.inventory_transactions
      add constraint inventory_transactions_source_check
      check (source in ('manual', 'template', 'template_reversal'));
  end if;
end
$checks$;

-- the hard stop on double deduction. even a direct insert that bypasses the
-- functions below cannot write the same item twice for one job and batch.
create unique index if not exists inventory_transactions_auto_uniq
  on public.inventory_transactions (job_id, item_id, deduct_batch, source)
  where source in ('template', 'template_reversal');

-- ---------------------------------------------------------------------------
-- jobs: link to a template by id, and record whether parts have been deducted.
-- parts_deducted_at is the guard. the deduct function only proceeds when it
-- can move that column from null to now() in a single statement, which takes
-- a row lock, so two concurrent callers cannot both win.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists template_id uuid references public.system_templates(id) on delete set null;

alter table public.jobs
  add column if not exists parts_deducted_at timestamptz;

alter table public.jobs
  add column if not exists parts_deduct_batch int not null default 0;

-- ---------------------------------------------------------------------------
-- seed from the old hardcoded SYSTEM_TEMPLATES array. labels are the join key
-- to jobs.system_template, so they match the old strings exactly.
-- ---------------------------------------------------------------------------
insert into public.system_templates (label, default_price, sort_order)
values
  ('Flagship Bundle',   2999, 10),
  ('Well Water Bundle', 3499, 20),
  ('Softener Only',     1499, 30),
  ('RO Only',            799, 40),
  ('Custom',            null, 50)
on conflict (label) do nothing;

-- backfill the new foreign key for jobs written before templates existed
update public.jobs j
set template_id = t.id
from public.system_templates t
where j.template_id is null and t.label = j.system_template;

-- ---------------------------------------------------------------------------
-- job_margin: sale price minus parts cost minus installer pay.
--
-- parts cost is summed from the ledger. install rows carry a negative
-- quantity, so -quantity is the count consumed. a reversal writes the
-- opposite sign, which subtracts itself back out and returns the margin to
-- where it was. unit_cost_at_txn is used, never inventory_items.unit_cost.
-- ---------------------------------------------------------------------------
create or replace view public.job_margin
with (security_invoker = true) as
select
  j.id,
  j.created_at,
  j.customer_name,
  j.city,
  j.system_template,
  j.template_id,
  j.status,
  j.install_date,
  j.installer,
  j.invoice_number,
  j.faucet_finish,
  j.parts_deducted_at,
  j.parts_deduct_batch,
  j.sale_price,
  coalesce(j.payout_amount, 0)::numeric(10,2) as installer_pay,
  coalesce(p.parts_cost, 0)::numeric(10,2)    as parts_cost,
  coalesce(p.parts_count, 0)::int             as parts_count,
  (j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0))::numeric(10,2) as margin,
  case
    when j.sale_price is null or j.sale_price = 0 then null
    else round(
      (j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0)) * 100.0 / j.sale_price,
      1)
  end as margin_pct
from public.jobs j
left join (
  select
    t.job_id,
    sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)) as parts_cost,
    sum(-t.quantity)                                   as parts_count
  from public.inventory_transactions t
  where t.job_id is not null
  group by t.job_id
) p on p.job_id = j.id;

-- ---------------------------------------------------------------------------
-- template_line_preview: every line of every template with its item joined,
-- so the Templates page can render a parts list without stitching joins in
-- the client. customer pick lines carry a null item and resolve per job.
-- ---------------------------------------------------------------------------
create or replace view public.template_line_preview
with (security_invoker = true) as
select
  tl.id,
  tl.template_id,
  tl.line_type,
  tl.item_id,
  tl.pick_source,
  tl.pick_category,
  tl.quantity,
  tl.sort_order,
  tl.note,
  i.sku,
  i.name     as item_name,
  i.category as item_category,
  i.variant  as item_variant,
  i.unit_cost,
  (tl.quantity * coalesce(i.unit_cost, 0))::numeric(10,2) as line_cost
from public.template_lines tl
left join public.inventory_items i on i.id = tl.item_id;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.system_templates enable row level security;
alter table public.template_lines   enable row level security;

drop policy if exists "system_templates_select" on public.system_templates;
drop policy if exists "system_templates_insert" on public.system_templates;
drop policy if exists "system_templates_update" on public.system_templates;
drop policy if exists "system_templates_delete" on public.system_templates;

create policy "system_templates_select" on public.system_templates
  for select to authenticated using ((select auth.uid()) is not null);

create policy "system_templates_insert" on public.system_templates
  for insert to authenticated with check ((select auth.uid()) is not null);

create policy "system_templates_update" on public.system_templates
  for update to authenticated using ((select auth.uid()) is not null);

create policy "system_templates_delete" on public.system_templates
  for delete to authenticated using ((select auth.uid()) is not null);

drop policy if exists "template_lines_select" on public.template_lines;
drop policy if exists "template_lines_insert" on public.template_lines;
drop policy if exists "template_lines_update" on public.template_lines;
drop policy if exists "template_lines_delete" on public.template_lines;

create policy "template_lines_select" on public.template_lines
  for select to authenticated using ((select auth.uid()) is not null);

create policy "template_lines_insert" on public.template_lines
  for insert to authenticated with check ((select auth.uid()) is not null);

create policy "template_lines_update" on public.template_lines
  for update to authenticated using ((select auth.uid()) is not null);

create policy "template_lines_delete" on public.template_lines
  for delete to authenticated using ((select auth.uid()) is not null);

notify pgrst, 'reload schema';
