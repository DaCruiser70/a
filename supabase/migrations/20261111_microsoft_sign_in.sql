-- ══════════════════════════════════════════════════════════════════════════════
-- Microsoft (Entra ID) sign-in for staff
-- Run each numbered statement on its own, in order, in the Supabase SQL editor.
-- Safe to re-run. Service role only: RLS on, no policies, nothing for anon or authenticated.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. The Microsoft id bound to a staff account on its first Microsoft sign-in. Every later
--    Microsoft sign-in must present the same issuer + subject. No tokens, no email.
CREATE TABLE IF NOT EXISTS public.microsoft_identities (
  id               uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id       uuid        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  ms_issuer        text        NOT NULL CHECK (length(ms_issuer) BETWEEN 1 AND 300),
  ms_subject       text        NOT NULL CHECK (length(ms_subject) BETWEEN 1 AND 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT microsoft_identities_subject_key UNIQUE (ms_issuer, ms_subject)
);

-- 2. Break-glass: named staff accounts that may still sign in with a password when
--    STAFF_PASSWORD_LOGIN is off. Kept out of profiles because users can update their own profile row.
--    Set only by SQL you run (see the bottom of this file).
CREATE TABLE IF NOT EXISTS public.staff_login_flags (
  user_id      uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  break_glass  boolean     NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 3. Every Microsoft sign-in attempt and every refused staff password sign-in: method, outcome and a
--    short reason code. user_id only when an account was matched (unknown emails have none).
CREATE TABLE IF NOT EXISTS public.sign_in_events (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  method      text        NOT NULL CHECK (method IN ('microsoft', 'password')),
  outcome     text        NOT NULL CHECK (outcome IN ('success', 'refused', 'break_glass')),
  reason      text        CHECK (reason ~ '^[a-z_]{1,32}$'),
  user_id     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 4. Indexes: the foreign keys and the filtered columns
CREATE INDEX IF NOT EXISTS idx_sign_in_events_user_id    ON public.sign_in_events(user_id);

-- 5.
CREATE INDEX IF NOT EXISTS idx_sign_in_events_created_at ON public.sign_in_events(created_at);

-- 6.
CREATE INDEX IF NOT EXISTS idx_staff_login_flags_break_glass ON public.staff_login_flags(break_glass) WHERE break_glass;

-- 7. RLS on, no policies
ALTER TABLE public.microsoft_identities ENABLE ROW LEVEL SECURITY;

-- 8.
ALTER TABLE public.staff_login_flags ENABLE ROW LEVEL SECURITY;

-- 9.
ALTER TABLE public.sign_in_events ENABLE ROW LEVEL SECURITY;

-- 10.
REVOKE ALL ON public.microsoft_identities, public.staff_login_flags, public.sign_in_events FROM anon, authenticated;

-- 11.
GRANT ALL ON public.microsoft_identities, public.staff_login_flags, public.sign_in_events TO service_role;

-- 12. Accounts matching an email, with whether each is active (auth user not deleted, not banned).
--     Matches the profile's AEM email or the auth email, case-insensitively. Returns ids and roles only.
CREATE OR REPLACE FUNCTION public.microsoft_sign_in_candidates(p_email text)
RETURNS TABLE (id uuid, roles text[], active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id,
         p.roles::text[],
         (u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())) AS active
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE length(p_email) BETWEEN 3 AND 254
     AND (lower(p.aem_email) = lower(p_email) OR lower(u.email) = lower(p_email))
$$;

-- 13. Removes the Microsoft (azure) identities Supabase linked to an account whose Microsoft
--     sign-in we refused, so a refused sign-in never leaves Microsoft attached to a password account.
CREATE OR REPLACE FUNCTION public.remove_microsoft_identities(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM auth.identities WHERE user_id = p_user_id AND provider = 'azure';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;

-- 14. Execute: service role only
REVOKE EXECUTE ON FUNCTION public.microsoft_sign_in_candidates(text) FROM PUBLIC, anon, authenticated;

-- 15.
REVOKE EXECUTE ON FUNCTION public.remove_microsoft_identities(uuid) FROM PUBLIC, anon, authenticated;

-- 16.
GRANT EXECUTE ON FUNCTION public.microsoft_sign_in_candidates(text) TO service_role;

-- 17.
GRANT EXECUTE ON FUNCTION public.remove_microsoft_identities(uuid) TO service_role;

-- 18. A Microsoft (or any OAuth) sign-in never creates a profile. Until now every new auth user got a
--     'newhire' profile; an auth user created by an OAuth sign-in (app_metadata.provider is not
--     'email') now gets none, so it holds no role, cannot enter any portal and is removed by the
--     callback. Users HR creates (admin createUser, provider 'email') are unchanged.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text := coalesce(new.raw_app_meta_data->>'role', 'newhire');
BEGIN
  IF coalesce(new.raw_app_meta_data->>'provider', 'email') <> 'email' THEN
    RETURN new;
  END IF;
  IF v_role NOT IN ('hr','newhire','stakeholder','payroll','manager','project_mgmt','clearance') THEN
    v_role := 'newhire';
  END IF;
  INSERT INTO public.profiles (id, full_name, aem_email, role, roles)
  VALUES (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email, v_role, ARRAY[v_role]);
  RETURN new;
END; $$;

-- ── Project-management members sign in as themselves (statements 19–31) ──────
-- A member's Microsoft id is bound to their own region_teams row. Their session is created on the
-- region's shared account (pm-ontario, pm-novascotia, pm-newbrunswick), which is unchanged.
-- Written so they also update a microsoft_identities / sign_in_events table created by an earlier
-- run of statements 1–3.

-- 19. A binding can belong to a team member instead of a staff account
ALTER TABLE public.microsoft_identities ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.region_teams(id) ON DELETE CASCADE;

-- 20.
ALTER TABLE public.microsoft_identities ALTER COLUMN profile_id DROP NOT NULL;

-- 21. Exactly one owner per binding: a staff account or a team member, never both, never neither
ALTER TABLE public.microsoft_identities DROP CONSTRAINT IF EXISTS microsoft_identities_one_owner, ADD CONSTRAINT microsoft_identities_one_owner CHECK (num_nonnulls(profile_id, member_id) = 1);

-- 22. One Microsoft id per member (also the index on the foreign key)
CREATE UNIQUE INDEX IF NOT EXISTS microsoft_identities_member_key ON public.microsoft_identities(member_id);

-- 23. Which team member a Microsoft sign-in was for (no name, no email)
ALTER TABLE public.sign_in_events ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.region_teams(id) ON DELETE SET NULL;

-- 24.
CREATE INDEX IF NOT EXISTS idx_sign_in_events_member_id ON public.sign_in_events(member_id);

-- 25. 'note': recorded alongside a sign-in, e.g. staff_over_member (the email is on a staff account
--     and on a project-management team; the staff account was used)
ALTER TABLE public.sign_in_events DROP CONSTRAINT IF EXISTS sign_in_events_outcome_check, ADD CONSTRAINT sign_in_events_outcome_check CHECK (outcome IN ('success', 'refused', 'break_glass', 'note'));

-- 26. Team members matching an email (any region, active or not). Ids and regions only.
CREATE OR REPLACE FUNCTION public.microsoft_member_candidates(p_email text)
RETURNS TABLE (id uuid, region text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.region, t.active
    FROM public.region_teams t
   WHERE length(p_email) BETWEEN 3 AND 254
     AND lower(t.member_email) = lower(p_email)
$$;

-- 27. The shared project-management account for a region (role exactly project_mgmt), with whether
--     it is active. The sign-in needs exactly one active row.
CREATE OR REPLACE FUNCTION public.microsoft_pm_account(p_region text)
RETURNS TABLE (id uuid, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id,
         (u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())) AS active
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE p.region = p_region
     AND p.roles::text[] = ARRAY['project_mgmt']
$$;

-- 28. Execute: service role only
REVOKE EXECUTE ON FUNCTION public.microsoft_member_candidates(text) FROM PUBLIC, anon, authenticated;

-- 29.
REVOKE EXECUTE ON FUNCTION public.microsoft_pm_account(text) FROM PUBLIC, anon, authenticated;

-- 30.
GRANT EXECUTE ON FUNCTION public.microsoft_member_candidates(text) TO service_role;

-- 31.
GRANT EXECUTE ON FUNCTION public.microsoft_pm_account(text) TO service_role;

-- 32. Reload
NOTIFY pgrst, 'reload schema';

-- ── Verify (run each; expected results in comments) ──────────────────────────
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('microsoft_identities','staff_login_flags','sign_in_events');  -- 3 rows, all true
-- SELECT has_table_privilege('anon', 'public.staff_login_flags', 'SELECT');                    -- false
-- SELECT has_function_privilege('anon', 'public.microsoft_sign_in_candidates(text)', 'EXECUTE'); -- false
-- SELECT has_function_privilege('authenticated', 'public.remove_microsoft_identities(uuid)', 'EXECUTE'); -- false
-- SELECT prosrc LIKE '%provider%' FROM pg_proc WHERE proname = 'handle_new_user';               -- true
-- SELECT count(*) FROM information_schema.columns WHERE table_name = 'microsoft_identities' AND column_name = 'member_id'; -- 1
-- SELECT is_nullable FROM information_schema.columns WHERE table_name = 'microsoft_identities' AND column_name = 'profile_id'; -- YES
-- SELECT has_function_privilege('anon', 'public.microsoft_pm_account(text)', 'EXECUTE');       -- false
-- Each region's shared account resolves to exactly one active row:
-- SELECT r, (SELECT count(*) FROM public.microsoft_pm_account(r) WHERE active) FROM unnest(ARRAY['Ontario','New Brunswick','Nova Scotia']) AS r; -- 1 for each

-- ── Break-glass (run only for named people, never a shared account) ──────────
-- Flag:   INSERT INTO public.staff_login_flags (user_id, break_glass) SELECT id, true FROM public.profiles WHERE lower(aem_email) = lower('<their email>')
--           ON CONFLICT (user_id) DO UPDATE SET break_glass = true, updated_at = now();
-- Unflag: UPDATE public.staff_login_flags SET break_glass = false, updated_at = now() WHERE user_id = (SELECT id FROM public.profiles WHERE lower(aem_email) = lower('<their email>'));
-- List:   SELECT p.full_name, p.aem_email FROM public.staff_login_flags f JOIN public.profiles p ON p.id = f.user_id WHERE f.break_glass;
