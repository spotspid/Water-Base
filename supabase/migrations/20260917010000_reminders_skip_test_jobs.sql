-- The morning reminder never nags about a test job. Same view as
-- 20260831000000_notifications.sql with one more condition.

create or replace view public.nag_candidates
with (security_invoker = true)
as
 WITH today AS (
         SELECT (now() AT TIME ZONE 'America/New_York'::text)::date AS d
        )
 SELECT j.id AS job_id,
    j.customer_name,
    j.system_template,
    j.scheduled_date,
    j.scheduled_date - t.d AS days_until_install,
    j.nag_snoozed_until,
    ca.status AS agreement_status,
    ca.status IS DISTINCT FROM 'completed'::text AS agreement_unsigned,
        CASE
            WHEN ca.sent_at IS NULL THEN NULL::integer
            ELSE t.d - (ca.sent_at AT TIME ZONE 'America/New_York'::text)::date
        END AS agreement_days_unsigned,
    COALESCE(ca.view_count, 0) AS agreement_view_count,
    wo.status AS work_order_status,
    wo.status IS DISTINCT FROM 'completed'::text AS work_order_unsigned,
        CASE
            WHEN wo.sent_at IS NULL THEN NULL::integer
            ELSE t.d - (wo.sent_at AT TIME ZONE 'America/New_York'::text)::date
        END AS work_order_days_unsigned,
    ins.name AS installer_name
   FROM jobs j
     CROSS JOIN today t
     LEFT JOIN agreements ca ON ca.job_id = j.id AND ca.type = 'customer_install'::text
     LEFT JOIN agreements wo ON wo.job_id = j.id AND wo.type = 'subcontractor_service'::text
     LEFT JOIN installers ins ON ins.id = j.installer_id
  WHERE j.scheduled_date IS NOT NULL AND j.scheduled_date >= t.d AND j.scheduled_date <= (t.d + 14) AND j.status <> 'cancelled'::text AND (j.nag_snoozed_until IS NULL OR j.nag_snoozed_until <= t.d) AND (ca.status IS DISTINCT FROM 'completed'::text OR wo.status IS DISTINCT FROM 'completed'::text)
    AND NOT j.is_test;
