-- Notification dedupe ledger (outbox cleanup). NOT run yet.
-- Run each numbered statement on its own in the Supabase SQL editor, in order. Safe to re-run.
--
-- Why: an outbox row's unique dedupe_key is what stops an event being sent twice. Several events
-- happen once per hire (all forms received, ready for payroll, payroll complete, …) and their callers
-- run again on later saves, relying on the duplicate being refused. Daily reminders also read their
-- history (how many were sent) and their start dates from earlier rows. Deleting old outbox rows
-- would break both. So every key is recorded here, permanently, and cleanup only deletes outbox rows.
--
-- A key row holds: the key, the template, the hire (deleted with the hire), when it was queued, and
-- for daily reminders the date and the refs (opaque ids of what was reminded about). No address, no
-- name, no content.
--
-- Deploy the app right after statement 9; then run statement 10 again (it is idempotent) to pick up
-- anything the old code queued in between.

-- 1.
CREATE TABLE IF NOT EXISTS public.notification_keys (
  dedupe_key     text        PRIMARY KEY,
  template       text        NOT NULL,
  newhire_id     uuid        REFERENCES public.profiles(id) ON DELETE CASCADE,
  reminder_date  date,
  refs           text[]      NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 2. Indexes: the foreign key and the filtered columns
CREATE INDEX IF NOT EXISTS idx_notification_keys_newhire  ON public.notification_keys(newhire_id);

-- 3.
CREATE INDEX IF NOT EXISTS idx_notification_keys_template ON public.notification_keys(template, created_at);

-- 4.
CREATE INDEX IF NOT EXISTS idx_notification_keys_reminder ON public.notification_keys(reminder_date) WHERE reminder_date IS NOT NULL;

-- 5. Cleanup reads by status and last update
CREATE INDEX IF NOT EXISTS idx_outbox_status_updated ON public.notification_outbox(status, updated_at);

-- 6.
ALTER TABLE public.notification_keys ENABLE ROW LEVEL SECURITY;

-- 7.
REVOKE ALL ON public.notification_keys FROM anon, authenticated;

-- 8.
GRANT ALL ON public.notification_keys TO service_role;

-- 9. Queue one notification: the key is recorded first, then the row. Returns the new outbox id, or
-- NULL when the key was ever used before (even if that outbox row has since been cleaned up).
-- One statement each, in one transaction, so a key and its row always go together.
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_dedupe_key text, p_template text, p_newhire_id uuid, p_audience text[], p_payload jsonb,
  p_reminder_date date DEFAULT NULL, p_refs text[] DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.notification_keys (dedupe_key, template, newhire_id, reminder_date, refs)
  VALUES (p_dedupe_key, p_template, p_newhire_id, p_reminder_date, COALESCE(p_refs, '{}'))
  ON CONFLICT (dedupe_key) DO NOTHING;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notification_outbox (dedupe_key, template, newhire_id, audience, payload, status)
  VALUES (p_dedupe_key, p_template, p_newhire_id, p_audience, p_payload, 'queued')
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 10. Record every key already in the outbox (idempotent; run again after deploying)
INSERT INTO public.notification_keys (dedupe_key, template, newhire_id, reminder_date, refs, created_at)
SELECT o.dedupe_key, o.template, o.newhire_id,
       CASE WHEN o.template = 'daily_reminder' AND o.payload ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (o.payload ->> 'date')::date END,
       CASE WHEN o.template = 'daily_reminder' AND jsonb_typeof(o.payload -> 'refs') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(o.payload -> 'refs')) ELSE '{}' END,
       o.created_at
  FROM public.notification_outbox o
ON CONFLICT (dedupe_key) DO NOTHING;

-- 11.
REVOKE EXECUTE ON FUNCTION public.enqueue_notification(text, text, uuid, text[], jsonb, date, text[]) FROM PUBLIC, anon, authenticated;

-- 12.
GRANT EXECUTE ON FUNCTION public.enqueue_notification(text, text, uuid, text[], jsonb, date, text[]) TO service_role;

-- 13.
NOTIFY pgrst, 'reload schema';

-- ── Verification (run on its own) ──
-- Expected: one row: outbox_keys_missing = 0, rls_on = true, anon_can_read = false,
--           anon_can_enqueue = false, enqueue_definer = false
--
-- SELECT
--   (SELECT count(*) FROM public.notification_outbox o
--     WHERE NOT EXISTS (SELECT 1 FROM public.notification_keys k WHERE k.dedupe_key = o.dedupe_key))   AS outbox_keys_missing,
--   (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_keys'::regclass)                AS rls_on,
--   has_table_privilege('anon', 'public.notification_keys', 'SELECT')                                     AS anon_can_read,
--   has_function_privilege('anon', 'public.enqueue_notification(text, text, uuid, text[], jsonb, date, text[])', 'EXECUTE') AS anon_can_enqueue,
--   (SELECT prosecdef FROM pg_proc WHERE oid = 'public.enqueue_notification(text, text, uuid, text[], jsonb, date, text[])'::regprocedure) AS enqueue_definer;
