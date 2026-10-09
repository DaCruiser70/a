-- Auth hardening: hashed OTP codes with attempt limits, and a rate-limit counter table.
-- Run once in the Supabase SQL editor. Safe to re-run.

ALTER TABLE public.otp_codes ADD COLUMN IF NOT EXISTS code_hash text;
ALTER TABLE public.otp_codes ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.otp_codes ALTER COLUMN code DROP NOT NULL;
DELETE FROM public.otp_codes;
CREATE INDEX IF NOT EXISTS idx_otp_codes_lookup ON public.otp_codes(user_id, used, expires_at);

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_window timestamptz; v_hits integer;
BEGIN
  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  INSERT INTO public.rate_limits (key, window_start, hits) VALUES (p_key, v_window, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET hits = public.rate_limits.hits + 1
  RETURNING hits INTO v_hits;
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
  END IF;
  RETURN v_hits <= p_max;
END; $$;

CREATE OR REPLACE FUNCTION public.verify_otp(p_user_id uuid, p_code_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.otp_codes%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.otp_codes
    WHERE user_id = p_user_id AND used = false AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  IF r.attempts >= 5 THEN
    UPDATE public.otp_codes SET used = true WHERE id = r.id;
    RETURN 'locked';
  END IF;
  IF r.code_hash = p_code_hash THEN
    UPDATE public.otp_codes SET used = true WHERE id = r.id;
    RETURN 'ok';
  END IF;
  UPDATE public.otp_codes SET attempts = attempts + 1 WHERE id = r.id;
  IF r.attempts + 1 >= 5 THEN
    UPDATE public.otp_codes SET used = true WHERE id = r.id;
    RETURN 'locked';
  END IF;
  RETURN 'bad';
END; $$;

REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_otp(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_otp(uuid, text) TO service_role;
NOTIFY pgrst, 'reload schema';
