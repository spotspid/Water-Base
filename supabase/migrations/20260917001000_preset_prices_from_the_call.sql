-- Preset prices from the Sept 17 call.
--
--   Well Water Bundle   3,499  ->  3,799
--   RO Only               799  ->  1,200
--   Softener Only       1,499  ->  2,999
--
-- Flagship Bundle stays at 2,999 and Custom stays unpriced.
--
-- A preset is where the new job and new quote forms start, not what a job
-- costs. A job already written keeps its own sale_price; nothing here touches
-- jobs. The deposit on the form follows the preset at thirty percent until
-- somebody types a deposit of their own.
--
-- Each update only moves a price still at the figure it replaces. Applied to
-- the live project through the REST API on the day, because the migration
-- connector had lost its authorisation, and written so a later run cannot
-- undo a price somebody has since changed on the Build sheets page.

update public.system_templates set default_price = 3799
where label = 'Well Water Bundle' and default_price = 3499;

update public.system_templates set default_price = 1200
where label = 'RO Only' and default_price = 799;

update public.system_templates set default_price = 2999
where label = 'Softener Only' and default_price = 1499;
