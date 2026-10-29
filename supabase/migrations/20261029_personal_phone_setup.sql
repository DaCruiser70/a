-- Personal Information: phone setup question, and a 'personal' reveal group for HR. NOT run yet.
-- Run each numbered step on its own in the Supabase SQL editor, in order. Safe to re-run.
--
-- Date of birth needs no new column: it is already personal_info.date_of_birth, encrypted with the
-- other personal fields (lib/personal-fields.ts). The clearance form never stored a date of birth,
-- so nothing is copied and nothing is dropped.
--
-- New columns are nullable: forms submitted before the question was added keep a null answer.
-- personal_phone is encrypted by the app (same helper and list as phone); only the server decrypts.
-- No new index: no query filters on these columns.

-- ── 1. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE public.personal_info
  ADD COLUMN IF NOT EXISTS phone_choice        text CHECK (phone_choice IN ('work','personal')),
  ADD COLUMN IF NOT EXISTS work_phone_platform text CHECK (work_phone_platform IN ('apple','android')),
  ADD COLUMN IF NOT EXISTS personal_phone      text;

-- ── 2. Only the chosen branch may hold an answer ─────────────────────────────
ALTER TABLE public.personal_info DROP CONSTRAINT IF EXISTS personal_info_phone_branch_check;
ALTER TABLE public.personal_info ADD CONSTRAINT personal_info_phone_branch_check CHECK (
  (work_phone_platform IS NULL OR phone_choice = 'work') AND
  (personal_phone      IS NULL OR phone_choice = 'personal')
);

-- ── 3. Reveal codes: allow the 'personal' group (date of birth, personal phone) ──
ALTER TABLE public.reveal_codes DROP CONSTRAINT IF EXISTS reveal_codes_grp_check;
ALTER TABLE public.reveal_codes ADD CONSTRAINT reveal_codes_grp_check CHECK (grp IN ('banking','sin','clearance','personal'));

-- ── 4. Reveal codes: issue function accepts the new group (verify needs no change) ──
CREATE OR REPLACE FUNCTION public.issue_reveal_code(
  p_hr_user_id uuid, p_hire_id uuid, p_group text, p_code_hash text, p_ttl_seconds integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_group NOT IN ('banking', 'sin', 'clearance', 'personal') OR p_ttl_seconds < 60 OR p_ttl_seconds > 900 THEN
    RETURN false;
  END IF;
  DELETE FROM public.reveal_codes
    WHERE hr_user_id = p_hr_user_id AND (used OR expires_at < now());
  UPDATE public.reveal_codes SET used = true
    WHERE hr_user_id = p_hr_user_id AND hire_id = p_hire_id AND grp = p_group AND NOT used;
  INSERT INTO public.reveal_codes (hr_user_id, hire_id, grp, purpose, code_hash, expires_at)
    VALUES (p_hr_user_id, p_hire_id, p_group, 'reveal', p_code_hash, now() + make_interval(secs => p_ttl_seconds));
  RETURN true;
END; $$;

-- ── 5. Function permissions (unchanged; re-applied after the replace) ────────
REVOKE EXECUTE ON FUNCTION public.issue_reveal_code(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_reveal_code(uuid, uuid, text, text, integer) TO service_role;

-- ── 6. Reload ────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='personal_info'
--     AND column_name IN ('phone_choice','work_phone_platform','personal_phone','date_of_birth');  -- 4 rows, all text
-- SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='personal_info';  -- before + 3
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'reveal_codes_grp_check';           -- includes 'personal'
