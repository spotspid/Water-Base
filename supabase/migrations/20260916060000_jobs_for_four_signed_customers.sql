-- ---------------------------------------------------------------------------
-- Four customers signed an installation agreement in DocuSeal and never got a
-- job in Water Base, so nothing was reserved for them and nobody would have
-- been reminded they exist.
--
--   Essie Goodbar         11211989   $1,099   RO only, Sep 25, 8 to 10am
--   Samuelkutty Abraham   11162797   $2,749   mixed bed with RO, Sep 24
--   Xhovano Dedaj         11220687   $2,299   carbon filtration with RO, no date
--   Vladimir Hysi         11019555   $2,749   mixed bed with RO, no date
--
-- Each job is inserted as sold and, where it has a date, scheduled through
-- schedule_job, the same path the schedule page uses, so the reservations
-- come from the trigger exactly as they would for a job typed in by hand.
-- The crew is left alone: nobody has been assigned.
--
-- Each agreement is linked to its submission with the times DocuSeal
-- recorded, as the other eight were. completed_at is the moment the last party
-- signed. No file URL is stored, because DocuSeal's expire.
--
-- Nothing is invented to make a build sheet resolve. Where the customer's
-- faucet finish, RO type or valve type is not known, the pick is left blank.
-- That line then reserves nothing and shows as unresolved, which is the true
-- state, rather than reserving a part somebody guessed.
--
-- Water source is city for all four: each is tagged "city water" in GHL.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.create_signed_job(
  p_customer      text,
  p_email         text,
  p_phone         text,
  p_address       text,
  p_city          text,
  p_price         numeric,
  p_template      text,
  p_ro_type       text,
  p_payment_type  text,
  p_scheduled     date,
  p_window        text,
  p_submission    text,
  p_sent_at       timestamptz,
  p_signed_at     timestamptz,
  p_notes         text
)
returns uuid
language plpgsql
as $create$
declare
  v_template uuid;
  v_job      uuid;
  v_result   json;
  v_rows     int;
begin
  if exists (select 1 from public.jobs where lower(btrim(customer_email)) = lower(btrim(p_email))) then
    raise exception '% already has a job under %. Stopping rather than create a second.', p_customer, p_email;
  end if;

  if exists (select 1 from public.agreements where docuseal_submission_id = p_submission) then
    raise exception 'DocuSeal submission % is already linked to a job. Stopping.', p_submission;
  end if;

  select id into v_template from public.system_templates where label = p_template;

  if v_template is null then
    raise exception 'There is no build sheet called "%", so % cannot be created on it.', p_template, p_customer;
  end if;

  insert into public.jobs (
    customer_name, customer_email, phone, address, city, water_source,
    system_template, template_id, sale_price, payment_type, ro_type, status, notes
  )
  values (
    p_customer, p_email, p_phone, p_address, p_city, 'city',
    p_template, v_template, p_price, p_payment_type, p_ro_type, 'sold', p_notes
  )
  returning id into v_job;

  if p_scheduled is not null then
    v_result := public.schedule_job(v_job, p_scheduled, p_window, null, null, false);

    if v_result ->> 'status' is distinct from 'scheduled'
       or (v_result ->> 'scheduled_date')::date is distinct from p_scheduled then
      raise exception 'Scheduling % for % did not land: %.', p_customer, p_scheduled, v_result;
    end if;
  end if;

  insert into public.agreements (
    job_id, type, docuseal_submission_id, status, sent_at, completed_at, send_count
  )
  values (
    v_job, 'customer_install', p_submission, 'completed', p_sent_at, p_signed_at, 0
  );

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    raise exception 'Linking % to DocuSeal % wrote % rows, expected 1.', p_customer, p_submission, v_rows;
  end if;

  -- the trigger copies the agreement state onto the job
  if not exists (select 1 from public.jobs where id = v_job and agreement_status = 'completed') then
    raise exception '% was created, but the job does not show the agreement as signed.', p_customer;
  end if;

  return v_job;
end;
$create$;

do $four$
declare
  v_sam uuid;
begin
  perform pg_temp.create_signed_job(
    'Essie Goodbar', 'badndabone@gmail.com', '(248) 872-0730', '2334 Phillips Dr', null,
    1099.00, 'RO Only', 'Tank Style', 'Check',
    '2026-09-25', '8:00 AM - 10:00 AM',
    '11211989', '2026-09-15T16:11:08.374Z', '2026-09-15T17:14:39.330Z',
    'Loaded 2026-09-16 from the signed agreement (DocuSeal 11211989) and the GHL conversation. '
    || 'Under sink tanked RO only. Scheduled Friday Sep 25: David offered "next Friday the 25th in '
    || 'the morning" on Sep 15 and she replied "Sounds good", with the usual 8 to 10am arrival '
    || 'window. Paying by check. She sent photos above and below the sink; the cleaners under the '
    || 'sink need moving and she said she will clear them out. City not supplied. Faucet finish not '
    || 'recorded, so the faucet line reserves nothing until it is set. Her work order 11218880 is '
    || 'sent to Jay Woodward and not yet signed.');

  v_sam := pg_temp.create_signed_job(
    'Samuelkutty Abraham', 'samaruthuckal@gmail.com', '+15866046989', '12858 Lilac Court',
    'Sterling Heights', 2749.00, 'Flagship Bundle', null, null,
    '2026-09-24', null,
    '11162797', '2026-09-14T14:48:21.146Z', '2026-09-14T14:55:17.341Z',
    'Loaded 2026-09-16 from the updated signed agreement (DocuSeal 11162797) and the GHL '
    || 'conversation. Mixed bed with RO, sold at $2,749. Scheduled Sep 24, but whether work already '
    || 'started is NOT confirmed: the install moved from the 19th to Monday Sep 14 morning, and on '
    || 'Sep 14 David sent the updated agreement adding the irrigation line reroute and said "we will '
    || 'be good to go for the 24th to get everything finished up". No message says what, if anything, '
    || 'was installed on the 14th. Confirm before marking installed. A deposit was paid by card on '
    || 'Stripe on Sep 10 and is NOT recorded as a payment here, because the amount is not known; the '
    || 'texts say 30 percent, with the rest by check on the day. Record it once the amount is '
    || 'confirmed. RO type, faucet finish and valve type are not recorded, so those lines reserve '
    || 'nothing until they are set. Work orders 11062803 (9/14) and 11163072 (9/24 updated) exist in '
    || 'DocuSeal and neither is fully signed. Superseded agreement 10976427 is kept on the job.');

  -- The first signed agreement, replaced by the updated one on Sep 14. Kept,
  -- as Prudhvi Yalavarthi's earlier work orders were.
  insert into public.agreement_history
    (job_id, type, docuseal_submission_id, status, sent_at, completed_at, signed_by, note)
  values
    (v_sam, 'customer_install', '10976427', 'completed',
     '2026-09-08T19:37:49.167Z', '2026-09-09T14:35:36.109Z', 'samaruthuckal@gmail.com',
     'First signed installation agreement. Superseded on Sep 14 by 11162797, which added the '
     || 'irrigation line reroute to the scope.');

  perform pg_temp.create_signed_job(
    'Xhovano Dedaj', 'xhovanodedaj@gmail.com', '+15869613038', '249 Shadywood', null,
    2299.00, 'Custom', 'Tank Style', null,
    null, null,
    '11220687', '2026-09-15T18:48:43.184Z', '2026-09-15T19:04:24.158Z',
    'Loaded 2026-09-16 from the signed agreement (DocuSeal 11220687, signed as Giovano Dedaj) and '
    || 'the GHL conversation. Carbon filtration with tank RO. No install date: he is building a new '
    || 'home that is not framed yet, and the GHL note says "minimum of 2 months out. Most likely 4-6 '
    || 'months." Left unscheduled so it reserves nothing. No build sheet matches carbon filtration '
    || 'with RO, so it sits on Custom with no parts; list its parts on the job before scheduling it. '
    || 'City not supplied.');

  perform pg_temp.create_signed_job(
    'Vladimir Hysi', 'vladimirhysi@hotmail.com', '(734) 486-6776', '18161 Ryanwood Dr', null,
    2749.00, 'Flagship Bundle', null, null,
    null, null,
    '11019555', '2026-09-09T18:18:56.510Z', '2026-09-09T19:39:40.510Z',
    'Loaded 2026-09-16 from the signed agreement (DocuSeal 11019555) and the GHL conversation. '
    || 'Mixed bed with RO. No install date: David asked for a preferred date on Sep 9 and again on '
    || 'Sep 14 and he has not replied. Left unscheduled so it reserves nothing. The agreement was '
    || 'signed from vhexpress17@gmail.com; GHL has vladimirhysi@hotmail.com, which is used here. '
    || 'City not supplied. RO type, faucet finish and valve type are not recorded.');
end;
$four$;
