-- city, payment_type and invoice_number become optional on a job.
--
-- All three were not null from the first migration, which is right for a job
-- typed into the app: the form asks for them and will not submit without
-- them. It is wrong for a signed agreement being back loaded, where the
-- paperwork genuinely does not carry a city, a payment method has not been
-- taken yet, and there is no invoice because nothing has been invoiced.
--
-- Forced to supply something, a back load writes 'Unknown' or 'PENDING-01'.
-- That is worse than a null in two ways. It reads on screen as a real value,
-- so nobody chases it. And it pollutes the data: 'Unknown' becomes a city
-- that sorts between Troy and White Lake, and settings_option_usage counts it
-- as a payment type in use.
--
-- A null says "not known" once, in the one place the application already
-- checks. The new job form keeps its own required validation, so this only
-- widens what a back load or a correction may record.
--
-- invoice_number has no unique constraint and nothing joins on it. It is
-- carried onto install transactions as the reference, where a null simply
-- leaves that reference empty.

alter table public.jobs
  alter column city drop not null;

alter table public.jobs
  alter column payment_type drop not null;

alter table public.jobs
  alter column invoice_number drop not null;

notify pgrst, 'reload schema';
