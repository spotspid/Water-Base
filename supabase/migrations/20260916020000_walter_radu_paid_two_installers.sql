-- ---------------------------------------------------------------------------
-- Walter Radu's install cost two installers, and the job said it cost none.
--
-- The payout was left blank when the job was back loaded, so job_margin
-- counted it as zero and showed a margin nobody earned. Two people were paid:
--
--   Anthony Thomas   $275   the original install on Aug 16, then let go
--   Jay Woodward     $200   Aug 20, a follow up visit to replace a damaged
--                          valve, swap the chrome faucet for nickel, and check
--                          Anthony's work (DocuSeal 10374165, agreed pay $200)
--
-- payout_amount is one figure per job, so it carries the total, and the split
-- goes in the notes where it is read beside the job rather than lost.
--
-- The notes are corrected in place, not only appended to. Two sentences in
-- them stopped being true: pay was never recorded (it is now) and Anthony is
-- stored as text because the roster was empty (the job points at Jay on the
-- roster since 20260916010000). Leaving them would have the note contradict
-- itself. Each replacement is checked, so a note edited since cannot be
-- silently left half corrected.
-- ---------------------------------------------------------------------------
do $walter$
declare
  v_job   constant uuid := 'a8da94cd-ae94-433d-ae8e-eec2c6657a89';
  v_pay   constant text := 'Installer pay was never recorded and is left blank.';
  v_text  constant text := ' Anthony Thomas is stored as text because the installer roster is empty.';
  v_split constant text := 'Installer payout is $475, paid to two people: Anthony Thomas $275 for '
    || 'the original install on Aug 16, after which he was let go, and Jay Woodward $200 on '
    || 'Aug 20 for a follow up visit to replace a damaged valve, swap the chrome faucet for '
    || 'nickel, and check Anthony''s work (DocuSeal 10374165).';
  v_notes text;
  v_rows  int;
begin
  select notes into v_notes from public.jobs where id = v_job for update;

  if not found then
    raise exception 'Walter Radu''s job % is not there.', v_job;
  end if;

  if position(v_pay in coalesce(v_notes, '')) = 0 then
    raise exception 'Walter Radu''s notes no longer say pay was never recorded, so they have '
      'been edited since. Stopping rather than guessing where the split belongs.';
  end if;

  if position(v_text in v_notes) = 0 then
    raise exception 'Walter Radu''s notes no longer carry the roster sentence, so they have been '
      'edited since. Stopping rather than guessing.';
  end if;

  update public.jobs
  set payout_amount = 475.00,
      notes = replace(replace(v_notes, v_pay, v_split), v_text, '')
  where id = v_job
    and payout_amount is null;

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Recording Walter Radu''s payout touched % rows, expected 1. It may already '
      'have a payout, which this will not overwrite.', v_rows;
  end if;
end;
$walter$;
