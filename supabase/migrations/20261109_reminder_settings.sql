-- Daily reminders pause switch (Prompt E4). NOT run yet.
-- Run each numbered statement on its own in the Supabase SQL editor, in order. Safe to re-run.
--
-- One row (id is always true). paused = true makes the daily reminder run queue nothing.

-- 1.
CREATE TABLE IF NOT EXISTS public.reminder_settings (
  id          boolean     PRIMARY KEY DEFAULT true CHECK (id),
  paused      boolean     NOT NULL DEFAULT false,
  changed_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at  timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. The single row, not paused
INSERT INTO public.reminder_settings (id, paused) VALUES (true, false) ON CONFLICT (id) DO NOTHING;

-- 3. Index on the foreign key
CREATE INDEX IF NOT EXISTS idx_reminder_settings_changed_by ON public.reminder_settings(changed_by);

-- 4.
ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;

-- 5. Service role only: no policies, nothing for anon or authenticated
REVOKE ALL ON public.reminder_settings FROM anon, authenticated;

-- 6.
GRANT ALL ON public.reminder_settings TO service_role;

-- 7.
NOTIFY pgrst, 'reload schema';

-- ── Verification (run on its own) ──
-- Expected: one row: rows = 1, paused = false, rls_on = true, anon_can_read = false, auth_can_read = false
--
-- SELECT
--   (SELECT count(*) FROM public.reminder_settings)                                        AS rows,
--   (SELECT paused FROM public.reminder_settings WHERE id)                                  AS paused,
--   (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reminder_settings'::regclass)  AS rls_on,
--   has_table_privilege('anon', 'public.reminder_settings', 'SELECT')                       AS anon_can_read,
--   has_table_privilege('authenticated', 'public.reminder_settings', 'SELECT')              AS auth_can_read;
