-- One-time codes that gate HR reveals of a hire's SIN or banking numbers (Prompt S1). NOT run yet.
-- Run this once in the Supabase SQL editor before deploying the new reveal routes. Safe to re-run.
--
-- Kept apart from otp_codes on purpose: verify_otp picks the newest unused code for an account and
-- issueLoginCode invalidates every unused code for it, so sharing that table would let login and
-- reveal codes cancel each other. otp_codes and verify_otp are not touched.
--
-- A code is bound to the HR user, the hire, the group ('banking' or 'sin') and the 'reveal'
-- purpose; only its HMAC is stored (the code itself never reaches the database). 5 minutes,
-- single use, 5 attempts.

CREATE TABLE IF NOT EXISTS public.reveal_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hr_user_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hire_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  grp         text        NOT NULL CHECK (grp IN ('banking', 'sin')),
  purpose     text        NOT NULL DEFAULT 'reveal' CHECK (purpose = 'reveal'),
  code_hash   text        NOT NULL,
  attempts    integer     NOT NULL DEFAULT 0,
  used        boolean     NOT NULL DEFAULT false,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reveal_codes_hr_user ON public.reveal_codes(hr_user_id);
CREATE INDEX IF NOT EXISTS idx_reveal_codes_hire    ON public.reveal_codes(hire_id);
CREATE INDEX IF NOT EXISTS idx_reveal_codes_lookup  ON public.reveal_codes(hr_user_id, hire_id, grp, used, expires_at);
CREATE INDEX IF NOT EXISTS idx_reveal_codes_expires ON public.reveal_codes(expires_at);
ALTER TABLE public.reveal_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reveal_codes FROM anon, authenticated;
GRANT ALL ON public.reveal_codes TO service_role;

-- Issue: one statement-level unit. Old codes for the same binding stop working, expired or used
-- rows for this HR user are cleared, and the new hash is stored.
CREATE OR REPLACE FUNCTION public.issue_reveal_code(
  p_hr_user_id uuid, p_hire_id uuid, p_group text, p_code_hash text, p_ttl_seconds integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_group NOT IN ('banking', 'sin') OR p_ttl_seconds < 60 OR p_ttl_seconds > 900 THEN
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

-- Verify: same rules as verify_otp, scoped to the binding. Returns 'ok', 'bad', 'locked' or 'none'.
CREATE OR REPLACE FUNCTION public.verify_reveal_code(
  p_hr_user_id uuid, p_hire_id uuid, p_group text, p_code_hash text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reveal_codes%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.reveal_codes
    WHERE hr_user_id = p_hr_user_id AND hire_id = p_hire_id AND grp = p_group
      AND purpose = 'reveal' AND NOT used AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  IF r.attempts >= 5 THEN
    UPDATE public.reveal_codes SET used = true WHERE id = r.id;
    RETURN 'locked';
  END IF;
  IF r.code_hash = p_code_hash THEN
    UPDATE public.reveal_codes SET used = true WHERE id = r.id;
    RETURN 'ok';
  END IF;
  UPDATE public.reveal_codes SET attempts = attempts + 1 WHERE id = r.id;
  IF r.attempts + 1 >= 5 THEN
    UPDATE public.reveal_codes SET used = true WHERE id = r.id;
    RETURN 'locked';
  END IF;
  RETURN 'bad';
END; $$;

REVOKE EXECUTE ON FUNCTION public.issue_reveal_code(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_reveal_code(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_reveal_code(uuid, uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_reveal_code(uuid, uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Check (expect 10 columns):
-- SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reveal_codes';
