-- The first organisation, and who belongs to it.
--
-- v2's policies ask whether the caller is a member of the row's organisation.
-- With no organisation and no memberships, every policy is correctly false and
-- every page reads as though the business has no data, which looks exactly
-- like data loss. So the tenant exists before the first page does.
--
-- Michigan Water Pros is organisation one. When this is sold to other dealers
-- each gets a row here and sees only its own, which is the entire difference
-- between this schema and the one it replaces, where all twenty five policies
-- read "are you signed in".
--
-- Everyone who can sign in today is made an owner, because today there is one
-- business and three people who run it. Roles get meaning when there is a
-- second organisation to keep somebody out of.

insert into v2.organizations (name)
select 'Michigan Water Pros'
where not exists (select 1 from v2.organizations where lower(name) = 'michigan water pros');

insert into v2.memberships (user_id, org_id, role)
select u.id, o.id, 'owner'
from auth.users u
cross join v2.organizations o
where lower(o.name) = 'michigan water pros'
on conflict (user_id, org_id) do nothing;

-- Proof.
do $$
declare
  v_org     uuid;
  v_people  int;
  v_users   int;
begin
  select id into v_org from v2.organizations where lower(name) = 'michigan water pros';

  if v_org is null then
    raise exception 'The organisation was not created.';
  end if;

  select count(*) into v_people from v2.memberships where org_id = v_org;
  select count(*) into v_users from auth.users;

  if v_people <> v_users then
    raise exception 'Of % people who can sign in, % are in the organisation.', v_users, v_people;
  end if;

  -- my_orgs is what every policy calls. If it cannot answer, nothing is
  -- readable and the first page looks empty rather than broken.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'v2' and p.proname = 'my_orgs') then
    raise exception 'v2.my_orgs is missing, so no policy can resolve.';
  end if;

  raise notice 'Michigan Water Pros exists and all % people belong to it', v_people;
end $$;
