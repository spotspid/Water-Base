-- The customer agreement's DocuSeal template id.
--
-- The work order got its id in 20260828000000 and the customer agreement never
-- got one, so agreement_types has carried a null since the agreements table
-- was created. Every customer send would have stopped at "Customer Install
-- Agreement has no DocuSeal template id", which is the right error and was
-- never seen because nothing had ever been sent.
--
-- Recorded here rather than typed into the settings page for the same reason
-- the work order's was: which document a type points at is a fact about this
-- deployment, and a fact nobody wrote down is one that gets lost the next time
-- the database is rebuilt.

update public.agreement_types
set docuseal_template_id = '5520400',
    active               = true,
    updated_at           = now()
where type = 'customer_install'
  and docuseal_template_id is distinct from '5520400';

do $$
declare
  v_id text;
begin
  select docuseal_template_id into v_id
  from public.agreement_types where type = 'customer_install';

  if v_id is distinct from '5520400' then
    raise exception 'customer_install should point at template 5520400, found %', v_id;
  end if;
end $$;

notify pgrst, 'reload schema';
