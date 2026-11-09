-- Notification dispatcher (Prompt E3). NOT run yet.
-- Run each numbered statement on its own in the Supabase SQL editor, in order. Safe to re-run.
--
-- notification_outbox becomes the delivery queue:
--   status      queued → sending → sent, or failed (retry scheduled) → … → dead after 5 attempts
--   audience    who it is for, as role keys ('hr', 'payroll', 'hire', 'manager', …). Addresses are
--               never stored: the dispatcher looks them up at send time. to_emails is dropped.
--   newhire_id  the hire the event is about (HR's list, the hire's name at send time)
--   claimed_at  set when a dispatcher run claims the row; a row stuck in 'sending' for more than
--               10 minutes goes back to 'queued'
--   delivered   HMACs of the addresses already sent to (live mode), so a retry after a partial
--               failure never sends twice. Never an address.
--   last_error  a short error code only (for example 'throttled', 'no_recipients')
-- Dedupe keys are rewritten to one format: template:hireId:audience:version.

-- 1. Status values: drop the old check first
ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_status_check;

-- 2. 'pending' is now 'queued'
UPDATE public.notification_outbox SET status = 'queued' WHERE status = 'pending';

-- 3.
ALTER TABLE public.notification_outbox ALTER COLUMN status SET DEFAULT 'queued';

-- 4.
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'dead'));

-- 5. New columns
ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS newhire_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS audience   text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered  text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 6. Existing rows: the hire from the payload (only ids that exist)
UPDATE public.notification_outbox o
   SET newhire_id = p.id
  FROM public.profiles p
 WHERE o.newhire_id IS NULL
   AND o.payload ->> 'newhireId' ~ '^[0-9a-fA-F-]{36}$'
   AND p.id = (o.payload ->> 'newhireId')::uuid;

-- 7. Existing rows: audience by template, the region for project management, and the dedupe key in
-- the new format. Old keys: see the WHEN lines. A row already in the new format is left alone.
UPDATE public.notification_outbox SET
  audience = CASE template
    WHEN 'manager_plan_requested' THEN ARRAY['manager']
    WHEN 'clearance_unlocked'     THEN ARRAY['hire']
    WHEN 'pm_request_created'     THEN ARRAY['pm_region']
    WHEN 'clearance_package_sent' THEN ARRAY['clearance']
    WHEN 'vehicle_rob_task'       THEN ARRAY['vehicle_rob']
    WHEN 'vehicle_heather_task'   THEN ARRAY['vehicle_heather']
    WHEN 'vehicle_insurance_task' THEN ARRAY['vehicle_marley']
    ELSE ARRAY['hr']
  END,
  payload = CASE
    WHEN template = 'pm_request_created' THEN (payload - 'link' - 'hireName') || jsonb_build_object('region', split_part(dedupe_key, ':', 3))
    ELSE payload - 'link' - 'hireName'
  END,
  dedupe_key = CASE
    -- manager_plan_request:H:M:SEQ
    WHEN template = 'manager_plan_requested' THEN
      'manager_plan_requested:' || split_part(dedupe_key, ':', 2) || ':manager:' || split_part(dedupe_key, ':', 3) || ':' || split_part(dedupe_key, ':', 4)
    -- pm_request_created:H:REGION
    WHEN template = 'pm_request_created' THEN
      'pm_request_created:' || split_part(dedupe_key, ':', 2) || ':pm_region:' || split_part(dedupe_key, ':', 3) || ':1'
    -- clearance_package_<event>:H:<timestamp, which contains colons>
    WHEN template IN ('clearance_package_sent', 'clearance_package_returned', 'clearance_package_done') THEN
      template || ':' || split_part(dedupe_key, ':', 2) || ':' || CASE WHEN template = 'clearance_package_sent' THEN 'clearance' ELSE 'hr' END
        || ':' || substr(dedupe_key, length(template) + 39)
    -- <template>:H
    ELSE template || ':' || split_part(dedupe_key, ':', 2) || ':' || CASE template
      WHEN 'clearance_unlocked'     THEN 'hire'
      WHEN 'vehicle_rob_task'       THEN 'vehicle_rob'
      WHEN 'vehicle_heather_task'   THEN 'vehicle_heather'
      WHEN 'vehicle_insurance_task' THEN 'vehicle_marley'
      ELSE 'hr' END || ':1'
  END
WHERE cardinality(audience) = 0;

-- 8. Addresses are never stored in the outbox again
ALTER TABLE public.notification_outbox DROP COLUMN IF EXISTS to_emails;

-- 9. Indexes: the hire (foreign key and HR's list) and stuck-row recovery
CREATE INDEX IF NOT EXISTS idx_outbox_newhire ON public.notification_outbox(newhire_id);

-- 10.
CREATE INDEX IF NOT EXISTS idx_outbox_sending_claimed ON public.notification_outbox(claimed_at) WHERE status = 'sending';

-- 11. Claim a small batch. Stuck rows (sending for over 10 minutes) go back to queued first. FOR
-- UPDATE SKIP LOCKED: two runs at the same time never claim the same row. p_only_ids limits the
-- run to those rows (Send now, and scripts/test-notifications.ts). Invoker rights: only the service
-- role can execute it, and it already has the table.
CREATE OR REPLACE FUNCTION public.claim_notifications(p_limit integer, p_only_ids uuid[] DEFAULT NULL)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.notification_outbox
     SET status = 'queued', claimed_at = NULL, updated_at = now()
   WHERE status = 'sending'
     AND claimed_at < now() - interval '10 minutes'
     AND (p_only_ids IS NULL OR id = ANY(p_only_ids));

  RETURN QUERY
  UPDATE public.notification_outbox o
     SET status = 'sending', claimed_at = now(), updated_at = now()
    FROM (
      SELECT n.id FROM public.notification_outbox n
       WHERE n.status IN ('queued', 'failed')
         AND n.send_after <= now()
         AND (p_only_ids IS NULL OR n.id = ANY(p_only_ids))
       ORDER BY n.send_after, n.created_at
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
       FOR UPDATE SKIP LOCKED
    ) picked
   WHERE o.id = picked.id
  RETURNING o.*;
END $$;

-- 12. A failed attempt: attempts + 1, the error code, and the next try (1 min, 5 min, 30 min, 2 h);
-- the fifth failure makes the row 'dead'. Only a row this run holds ('sending') changes.
-- Returns the new status, or NULL when the row was not in 'sending'.
CREATE OR REPLACE FUNCTION public.fail_notification(p_id uuid, p_code text)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
BEGIN
  UPDATE public.notification_outbox
     SET attempts   = attempts + 1,
         status     = CASE WHEN attempts + 1 >= 5 THEN 'dead' ELSE 'failed' END,
         send_after = now() + CASE attempts + 1
                                WHEN 1 THEN interval '1 minute'
                                WHEN 2 THEN interval '5 minutes'
                                WHEN 3 THEN interval '30 minutes'
                                ELSE interval '2 hours' END,
         last_error = CASE WHEN p_code ~ '^[a-z_]{1,40}$' THEN p_code ELSE 'unknown' END,
         claimed_at = NULL,
         updated_at = now()
   WHERE id = p_id AND status = 'sending'
  RETURNING status INTO v_status;
  RETURN v_status;
END $$;

-- 13. Active accounts holding a role, optionally limited to some ids. Reads auth.users (deleted or
-- banned accounts never get mail; roles from app_metadata, as requireRole uses), so it needs
-- definer rights. Returns the login address and name only.
CREATE OR REPLACE FUNCTION public.notify_active_accounts(p_role text, p_ids uuid[] DEFAULT NULL)
RETURNS TABLE (id uuid, email text, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.aem_email, p.full_name
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE u.deleted_at IS NULL
     AND (u.banned_until IS NULL OR u.banned_until <= now())
     AND COALESCE(u.raw_app_meta_data -> 'roles', '[]'::jsonb) ? p_role
     AND (p_ids IS NULL OR p.id = ANY(p_ids))
$$;

-- 14. Execute: service role only
REVOKE EXECUTE ON FUNCTION public.claim_notifications(integer, uuid[]) FROM PUBLIC, anon, authenticated;

-- 15.
REVOKE EXECUTE ON FUNCTION public.fail_notification(uuid, text) FROM PUBLIC, anon, authenticated;

-- 16.
REVOKE EXECUTE ON FUNCTION public.notify_active_accounts(text, uuid[]) FROM PUBLIC, anon, authenticated;

-- 17.
GRANT EXECUTE ON FUNCTION public.claim_notifications(integer, uuid[]) TO service_role;

-- 18.
GRANT EXECUTE ON FUNCTION public.fail_notification(uuid, text) TO service_role;

-- 19.
GRANT EXECUTE ON FUNCTION public.notify_active_accounts(text, uuid[]) TO service_role;

-- 20. The table keeps RLS on with no policies (unchanged); repeated here so a re-run confirms it
REVOKE ALL ON public.notification_outbox FROM anon, authenticated;

-- 21.
NOTIFY pgrst, 'reload schema';

-- ── Optional, before switching EMAIL_MODE to test or live ──
-- Every row that was 'pending' before this migration is now 'queued' and WILL be sent the first
-- time email is on. To skip that backlog instead (HR still sees each row, as Dead with "Queued
-- before email was switched on; not sent", and can Retry any of them), run this once, with the
-- day after you run the migration as the date:
--
-- UPDATE public.notification_outbox SET status = 'dead', last_error = 'backlog', updated_at = now()
--  WHERE status = 'queued' AND created_at < '2026-11-04';

-- ── Verification (run on its own) ──
-- Expected: one row:
--   to_emails_gone = true, status_values_ok = true, legacy_rows_without_audience = 0,
--   claim_definer = false, fail_definer = false, accounts_definer = true,
--   anon_can_claim = false, auth_can_accounts = false, rls_on = true
--
-- SELECT
--   NOT EXISTS (SELECT 1 FROM information_schema.columns
--               WHERE table_schema = 'public' AND table_name = 'notification_outbox' AND column_name = 'to_emails') AS to_emails_gone,
--   NOT EXISTS (SELECT 1 FROM public.notification_outbox
--               WHERE status NOT IN ('queued','sending','sent','failed','dead'))                                      AS status_values_ok,
--   (SELECT count(*) FROM public.notification_outbox WHERE cardinality(audience) = 0)                                 AS legacy_rows_without_audience,
--   (SELECT prosecdef FROM pg_proc WHERE oid = 'public.claim_notifications(integer, uuid[])'::regprocedure)          AS claim_definer,
--   (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fail_notification(uuid, text)'::regprocedure)                 AS fail_definer,
--   (SELECT prosecdef FROM pg_proc WHERE oid = 'public.notify_active_accounts(text, uuid[])'::regprocedure)          AS accounts_definer,
--   has_function_privilege('anon', 'public.claim_notifications(integer, uuid[])', 'EXECUTE')                          AS anon_can_claim,
--   has_function_privilege('authenticated', 'public.notify_active_accounts(text, uuid[])', 'EXECUTE')                AS auth_can_accounts,
--   (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_outbox'::regclass)                          AS rls_on;
