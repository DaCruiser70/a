-- One-time "set your password" links for new hires (Prompt E2). NOT run yet.
-- Run each statement on its own in the Supabase SQL editor, in order. Safe to re-run.
--
-- Only the SHA-256 of a token is stored (the token itself never reaches the database). A token
-- lasts 72 hours, works once, and issuing a new one for a user deletes that user's earlier unused
-- tokens in the same statement. Only newhire-only accounts can have one; staff are refused here
-- as well as in the app.

-- 1. Table
CREATE TABLE IF NOT EXISTS public.password_setup_tokens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash      text        NOT NULL CONSTRAINT password_setup_tokens_token_hash_key UNIQUE
                              CONSTRAINT password_setup_tokens_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  purpose         text        NOT NULL CHECK (purpose IN ('welcome', 'reset')),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivery_status text        NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('sent', 'failed', 'pending')),
  sent_at         timestamptz
);

-- 2-5. Indexes: both foreign keys and the filtered columns (token_hash has its unique index)
CREATE INDEX IF NOT EXISTS idx_password_setup_tokens_user       ON public.password_setup_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_setup_tokens_created_by ON public.password_setup_tokens(created_by);
CREATE INDEX IF NOT EXISTS idx_password_setup_tokens_created_at ON public.password_setup_tokens(created_at);
CREATE INDEX IF NOT EXISTS idx_password_setup_tokens_unused     ON public.password_setup_tokens(user_id) WHERE used_at IS NULL;

-- 6-8. Locked down like the other tables: service role only, no policies
ALTER TABLE public.password_setup_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_setup_tokens FROM anon, authenticated;
GRANT ALL ON public.password_setup_tokens TO service_role;

-- 9. Optional personal email for the welcome message, AES-256-GCM ciphertext from lib/encrypt.ts
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS contact_email text;

-- 10. Issue: one atomic unit. Refuses anything but a newhire-only account, deletes tokens older
-- than 30 days (any user), deletes this user's earlier unused tokens, stores the new hash.
-- Returns the new row id, or NULL when refused.
CREATE OR REPLACE FUNCTION public.issue_password_token(
  p_user_id uuid, p_token_hash text, p_purpose text, p_ttl_seconds integer, p_created_by uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_purpose NOT IN ('welcome', 'reset') OR p_ttl_seconds < 60 OR p_ttl_seconds > 259200
     OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'newhire' AND roles = ARRAY['newhire']::text[]) THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.password_setup_tokens WHERE created_at < now() - interval '30 days';
  DELETE FROM public.password_setup_tokens WHERE user_id = p_user_id AND used_at IS NULL;
  INSERT INTO public.password_setup_tokens (user_id, token_hash, purpose, expires_at, created_by)
    VALUES (p_user_id, p_token_hash, p_purpose, now() + make_interval(secs => p_ttl_seconds), p_created_by)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- 11. Consume: ONE conditional UPDATE. Only an unused, unexpired token of a newhire-only account
-- matches, so two clicks or two tabs cannot both get a row back.
CREATE OR REPLACE FUNCTION public.consume_password_token(p_token_hash text)
RETURNS TABLE (token_id uuid, user_id uuid, purpose text, token_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.password_setup_tokens t SET used_at = now()
    FROM public.profiles p
    WHERE t.token_hash = p_token_hash AND t.used_at IS NULL AND t.expires_at > now()
      AND p.id = t.user_id AND p.role = 'newhire' AND p.roles = ARRAY['newhire']::text[]
    RETURNING t.id, t.user_id, t.purpose, t.token_hash;
$$;

-- 12. Ends every session and refresh token of a newhire-only account, so anything issued before a
-- password change stops working. Returns the number of sessions removed, or -1 when refused.
CREATE OR REPLACE FUNCTION public.revoke_user_sessions(p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'newhire' AND roles = ARRAY['newhire']::text[]) THEN
    RETURN -1;
  END IF;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;

-- 13-18. Functions: service role only
REVOKE EXECUTE ON FUNCTION public.issue_password_token(uuid, text, text, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_password_token(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_user_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_password_token(uuid, text, text, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_password_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(uuid) TO service_role;

-- 19.
NOTIFY pgrst, 'reload schema';

-- Verify (expect: 10 | 1 | 3 | true):
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'password_setup_tokens') AS token_columns,
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'contact_email') AS contact_email_column,
--   (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('issue_password_token', 'consume_password_token', 'revoke_user_sessions')) AS functions,
--   (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.password_setup_tokens'::regclass) AS rls_on;
