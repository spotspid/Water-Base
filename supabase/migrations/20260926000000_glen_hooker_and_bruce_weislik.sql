-- ---------------------------------------------------------------------------
-- Glen Hooker and Bruce Weislik, both signed in DocuSeal with no job here.
--
-- The Documents page gap scan found them: four signed documents, two customers,
-- nothing in Water Base. Customer details come from the signed agreements and
-- work orders, so the job says what the customer put their name to.
--
--   Glen Hooker    $3,799  Well Water Bundle, tanked RO, chrome faucet
--                  agreement 11375871 signed Sep 24, work order 11577289
--                  signed Sep 25, install 9/28, Jay Woodward at $800
--
--   Bruce Weislik  $2,649  Softener Only, no RO
--                  agreement 11434944 signed Sep 22, work order 11448228
--                  signed Sep 24, install 9/30, Jay Woodward at $400
--
-- Each is written up as sold, then scheduled through schedule_job, the path the
-- schedule page uses, so the parts are claimed exactly as they would be for a
-- job booked by hand. Both work orders are already signed, so the crew and the
-- payout on them are recorded here rather than left blank.
--
-- Two things are deliberately left unset, because nothing signed says what they
-- are and a guess here reserves the wrong part:
--
--   valve type   Neither job names one. Glen's build sheet has a valve line, so
--                it will show as unresolved until somebody picks Clack or
--                Hankscraft. Bruce's agreement says "(No ceramic valve)", and
--                the app has no ceramic valve to pick, so his is open too.
--   time window  Glen's work order says "12-3pm", which is not one of the
--                windows the app offers. The day is recorded, the window is
--                not, and the note says so.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.job_from_documents(
  p_customer    text,
  p_email       text,
  p_phone       text,
  p_address     text,
  p_city        text,
  p_source      text,
  p_template    text,
  p_price       numeric,
  p_ro_type     text,
  p_faucet      text,
  p_scheduled   date,
  p_window      text,
  p_payout      numeric,
  p_conditions  text,
  p_notes       text
)
returns uuid
language plpgsql
as $build$
declare
  v_template uuid;
  v_jay      uuid;
  v_job      uuid;
  v_result   json;
  v_rows     int;
begin
  if exists (select 1 from public.jobs where lower(btrim(customer_email)) = lower(btrim(p_email))) then
    raise exception '% already has a job under %. Stopping rather than create a second.', p_customer, p_email;
  end if;

  select id into v_template from public.system_templates where label = p_template;
  if v_template is null then
    raise exception 'There is no build sheet called "%".', p_template;
  end if;

  select id into v_jay from public.installers where lower(btrim(email)) = 'jay.awoodward@gmail.com';
  if v_jay is null then
    raise exception 'Jay Woodward is not on the installer roster, and both work orders are signed by him.';
  end if;

  insert into public.jobs (
    customer_name, customer_email, phone, address, city, water_source,
    system_template, template_id, sale_price, ro_type, faucet_finish,
    payout_amount, site_conditions, status, notes
  )
  values (
    p_customer, p_email, p_phone, p_address, p_city, p_source,
    p_template, v_template, p_price, p_ro_type, p_faucet,
    p_payout, p_conditions, 'sold', p_notes
  )
  returning id into v_job;

  update public.jobs set installer_id = v_jay where id = v_job;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Setting the crew on % touched % rows, expected 1.', p_customer, v_rows;
  end if;

  v_result := public.schedule_job(v_job, p_scheduled, p_window, v_jay, null, true);

  if v_result ->> 'status' is distinct from 'scheduled'
     or (v_result ->> 'scheduled_date')::date is distinct from p_scheduled then
    raise exception 'Scheduling % for % did not land: %.', p_customer, p_scheduled, v_result;
  end if;

  return v_job;
end;
$build$;

create or replace function pg_temp.link_document(
  p_job        uuid,
  p_type       text,
  p_submission text,
  p_sent       timestamptz,
  p_signed     timestamptz
)
returns void
language plpgsql
as $link$
declare
  v_rows int;
begin
  if exists (select 1 from public.agreements where docuseal_submission_id = p_submission) then
    raise exception 'DocuSeal submission % is already linked.', p_submission;
  end if;

  insert into public.agreements (job_id, type, docuseal_submission_id, status, sent_at, completed_at, send_count)
  values (p_job, p_type, p_submission, 'completed', p_sent, p_signed, 0);

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Linking % wrote % rows, expected 1.', p_submission, v_rows;
  end if;
end;
$link$;

do $two$
declare
  v_glen  uuid;
  v_bruce uuid;
begin
  v_glen := pg_temp.job_from_documents(
    'Glen Hooker', 'glendynadude@aol.com', '(248) 388-3235',
    '32046 Alameda Dr, Farmington Hills, MI 48336', 'Farmington Hills', 'well',
    'Well Water Bundle', 3799.00, 'Tank Style', 'Chrome',
    '2026-09-28', null, 800.00,
    'They have a crawl. The old system (now gone) was in the first floor. We will hook it up in same spot. '
    || 'His kitchen sink has hole for soap dispenser which we can use for new faucet ideally.',
    'Loaded 2026-09-26 from the signed agreement (DocuSeal 11375871, signed Sep 24) and the signed work '
    || 'order (11577289, job 024, signed Sep 25). Sold as "Whole home dual tank air injection well system. '
    || 'Free under sink tanked reverse osmosis unit for perfectly clean drinking water." at $3,799. '
    || 'Install 9/28, arrival 12 to 3pm on the work order, which is not one of the windows this app offers, '
    || 'so the window is blank here. Jay Woodward at $800 per the work order. Valve type not named on either '
    || 'document, so the build sheet''s valve line is unresolved until one is picked.');

  v_bruce := pg_temp.job_from_documents(
    'Bruce Weislik', 'bweislik@comcast.net', '(248) 361-5565',
    '23757 Point O Woods Ct, South Lyon, MI 48178', 'South Lyon', 'city',
    'Softener Only', 2649.00, 'No RO', 'N/A',
    '2026-09-30', '8:00 AM - 10:00 AM', 400.00,
    'This client has a current softener. Hes deciding weather to have us take it or leave it. '
    || 'Also his outlet is about 10ft away. Will need extension cord.',
    'Loaded 2026-09-26 from the signed agreement (DocuSeal 11434944, signed Sep 22) and the signed work '
    || 'order (11448228, job 017, signed Sep 24). Sold as "Standard whole home mixed bed water filtration '
    || 'and softening system. (No ceramic valve)" at $2,649. No RO, so no faucet. Install 9/30, 8 to 10am. '
    || 'Jay Woodward at $400 per the work order. Water source recorded as city; neither document says. '
    || 'Valve type is open: the agreement says no ceramic valve, and this app offers only Clack and '
    || 'Hankscraft, so pick one before the install.');

  perform pg_temp.link_document(v_glen, 'customer_install', '11375871',
    '2026-09-20T14:11:01.426Z', '2026-09-24T21:45:14.949Z');
  perform pg_temp.link_document(v_glen, 'subcontractor_service', '11577289',
    '2026-09-25T17:02:33.442Z', '2026-09-25T19:31:17.227Z');
  perform pg_temp.link_document(v_bruce, 'customer_install', '11434944',
    '2026-09-22T13:36:58.463Z', '2026-09-22T13:39:00.510Z');
  perform pg_temp.link_document(v_bruce, 'subcontractor_service', '11448228',
    '2026-09-22T18:03:43.838Z', '2026-09-24T17:24:49.582Z');

  if (select count(*) from public.agreements a
      where a.job_id in (v_glen, v_bruce) and a.status = 'completed') <> 4 then
    raise exception 'The four documents did not all land as signed.';
  end if;
end;
$two$;
