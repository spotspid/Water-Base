-- faucet_finish becomes optional on a job.
--
-- It was not null from the first migration, on the assumption that a job is
-- written up in the app with every choice made. Real signed agreements do not
-- work that way: the paperwork is signed before the customer has picked a
-- finish, and back loading those jobs needs somewhere to record "not chosen
-- yet" that is not a guess.
--
-- Nothing downstream breaks on a null. resolve_template_parts already treats
-- an unmatched pick value as unresolved, sync_job_reservations leaves those
-- lines unreserved and reports the count, and mark_job_installed refuses the
-- whole install rather than deducting part of it. So a job with no finish
-- cannot quietly consume the wrong faucet, it simply cannot be installed
-- until someone chooses.
--
-- The new job form keeps its own required validation, so a job typed into the
-- app still cannot be saved without a finish. This only widens what a back
-- load or a correction is allowed to record.
--
-- ro_type was added nullable from the start, for the same reason.

alter table public.jobs
  alter column faucet_finish drop not null;

notify pgrst, 'reload schema';
