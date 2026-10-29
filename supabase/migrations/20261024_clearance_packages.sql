-- Clearance packages, per-form review and the 'clearance' reviewer role. NOT run yet.
-- Needs 20261023_reveal_codes.sql to have been run first (steps 10 and 11 change reveal_codes).
-- Run each numbered step on its own in the Supabase SQL editor, in order. Safe to re-run.
--
-- Design: the package lives on clearance_tracking (one row per hire, already HR's clearance
-- tracker) instead of a new table. A small clearance_stage_history table records every move.
-- Per-form review (RCMP form, PSPC fingerprint form) is added to clearance_info.
-- Nothing here touches profiles.status, computeHireStatus, progress or payroll.

-- ── 1. Per-form review on clearance_info ─────────────────────────────────────
ALTER TABLE public.clearance_info ADD COLUMN IF NOT EXISTS rcmp_review               text NOT NULL DEFAULT 'pending';
ALTER TABLE public.clearance_info ADD COLUMN IF NOT EXISTS rcmp_reject_reason        text;
ALTER TABLE public.clearance_info ADD COLUMN IF NOT EXISTS rcmp_reviewed_at          timestamptz;
ALTER TABLE public.clearance_info ADD COLUMN IF NOT EXISTS rcmp_reviewed_by          uuid REFERENCES public.profiles(id);
ALTER TABLE public.clearance_info ADD COLUMN IF NOT EXISTS fingerprint_review        text NOT NULL DEFAULT 'pending';
ALTER TABLE public.clearance_info ADD COLUMN IF NOT EXISTS fingerprint_reject_reason text;
ALTER TABLE public.clearance_info ADD COLUMN IF NOT EXISTS fingerprint_reviewed_at   timestamptz;
ALTER TABLE public.clearance_info ADD COLUMN IF NOT EXISTS fingerprint_reviewed_by   uuid REFERENCES public.profiles(id);

-- ── 2. Checks and indexes for step 1 ─────────────────────────────────────────
ALTER TABLE public.clearance_info DROP CONSTRAINT IF EXISTS clearance_info_rcmp_review_check;
ALTER TABLE public.clearance_info ADD CONSTRAINT clearance_info_rcmp_review_check
  CHECK (rcmp_review IN ('pending','approved','rejected'));
ALTER TABLE public.clearance_info DROP CONSTRAINT IF EXISTS clearance_info_fingerprint_review_check;
ALTER TABLE public.clearance_info ADD CONSTRAINT clearance_info_fingerprint_review_check
  CHECK (fingerprint_review IN ('pending','approved','rejected'));
ALTER TABLE public.clearance_info DROP CONSTRAINT IF EXISTS clearance_info_reject_reason_length;
ALTER TABLE public.clearance_info ADD CONSTRAINT clearance_info_reject_reason_length
  CHECK (char_length(coalesce(rcmp_reject_reason, '')) <= 2000 AND char_length(coalesce(fingerprint_reject_reason, '')) <= 2000);
CREATE INDEX IF NOT EXISTS idx_clearance_info_rcmp_reviewed_by        ON public.clearance_info(rcmp_reviewed_by);
CREATE INDEX IF NOT EXISTS idx_clearance_info_fingerprint_reviewed_by ON public.clearance_info(fingerprint_reviewed_by);

-- ── 3. Carry over forms HR already approved (test data; both files counted as approved) ──
UPDATE public.clearance_info SET rcmp_review = 'approved'
  WHERE form_status = 'approved' AND rcmp_path IS NOT NULL AND rcmp_review = 'pending';
UPDATE public.clearance_info SET fingerprint_review = 'approved'
  WHERE form_status = 'approved' AND fingerprint_path IS NOT NULL AND fingerprint_review = 'pending';

-- ── 4. Package stage and "Sent to BGIS" on clearance_tracking ────────────────
ALTER TABLE public.clearance_tracking ADD COLUMN IF NOT EXISTS package_stage    text;
ALTER TABLE public.clearance_tracking ADD COLUMN IF NOT EXISTS package_sent_at  timestamptz;
ALTER TABLE public.clearance_tracking ADD COLUMN IF NOT EXISTS stage_updated_at timestamptz;
ALTER TABLE public.clearance_tracking ADD COLUMN IF NOT EXISTS stage_updated_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.clearance_tracking ADD COLUMN IF NOT EXISTS returned_note    text;
ALTER TABLE public.clearance_tracking ADD COLUMN IF NOT EXISTS returned_at      timestamptz;
ALTER TABLE public.clearance_tracking ADD COLUMN IF NOT EXISTS done_at          timestamptz;
ALTER TABLE public.clearance_tracking ADD COLUMN IF NOT EXISTS sent_to_bgis     boolean NOT NULL DEFAULT false;
ALTER TABLE public.clearance_tracking ADD COLUMN IF NOT EXISTS sent_to_bgis_at  timestamptz;
ALTER TABLE public.clearance_tracking ADD COLUMN IF NOT EXISTS sent_to_bgis_by  uuid REFERENCES public.profiles(id);

-- ── 5. Checks and indexes for step 4 ─────────────────────────────────────────
ALTER TABLE public.clearance_tracking DROP CONSTRAINT IF EXISTS clearance_tracking_package_stage_check;
ALTER TABLE public.clearance_tracking ADD CONSTRAINT clearance_tracking_package_stage_check
  CHECK (package_stage IS NULL OR package_stage IN ('needs_review','in_process','done','returned'));
ALTER TABLE public.clearance_tracking DROP CONSTRAINT IF EXISTS clearance_tracking_returned_note_length;
ALTER TABLE public.clearance_tracking ADD CONSTRAINT clearance_tracking_returned_note_length
  CHECK (char_length(coalesce(returned_note, '')) <= 1000);
CREATE INDEX IF NOT EXISTS idx_clearance_tracking_stage         ON public.clearance_tracking(package_stage);
CREATE INDEX IF NOT EXISTS idx_clearance_tracking_stage_by      ON public.clearance_tracking(stage_updated_by);
CREATE INDEX IF NOT EXISTS idx_clearance_tracking_bgis_by       ON public.clearance_tracking(sent_to_bgis_by);
CREATE INDEX IF NOT EXISTS idx_clearance_tracking_package_sent  ON public.clearance_tracking(package_sent_at DESC);

-- ── 6. Stage history ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clearance_stage_history (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  newhire_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  from_stage  text        CHECK (from_stage IS NULL OR from_stage IN ('needs_review','in_process','done','returned')),
  to_stage    text        NOT NULL CHECK (to_stage IN ('needs_review','in_process','done','returned')),
  actor_id    uuid        REFERENCES public.profiles(id),
  note        text        CHECK (char_length(coalesce(note, '')) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clearance_stage_history_hire  ON public.clearance_stage_history(newhire_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clearance_stage_history_actor ON public.clearance_stage_history(actor_id);
ALTER TABLE public.clearance_stage_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clearance_stage_history FROM anon, authenticated;
GRANT ALL ON public.clearance_stage_history TO service_role;

-- ── 7. Stage moves: one function = one atomic step ───────────────────────────
-- Only these moves exist:
--   (unsent)                 → needs_review   automatic send when the package is ready
--   returned                 → needs_review   HR "Fix and resend"
--   needs_review             → in_process     reviewer
--   in_process               → done           reviewer
--   needs_review|in_process  → returned       reviewer, note required
-- p_expected is the stage the caller saw ('unsent' for a package never sent). The update only
-- applies WHERE the stage still equals it, so a second click or a second tab gets 'conflict'.
CREATE OR REPLACE FUNCTION public.move_clearance_stage(
  p_newhire_id uuid, p_expected text, p_to text, p_actor_id uuid, p_note text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from text := CASE WHEN p_expected = 'unsent' THEN NULL ELSE p_expected END;
  v_now  timestamptz := now();
  v_rows integer;
BEGIN
  IF NOT (
       (p_expected = 'unsent'       AND p_to = 'needs_review')
    OR (p_expected = 'returned'     AND p_to = 'needs_review')
    OR (p_expected = 'needs_review' AND p_to = 'in_process')
    OR (p_expected = 'in_process'   AND p_to = 'done')
    OR (p_expected IN ('needs_review','in_process') AND p_to = 'returned')
  ) THEN
    RETURN 'invalid';
  END IF;
  IF p_to = 'returned' AND char_length(trim(coalesce(p_note, ''))) = 0 THEN
    RETURN 'note_required';
  END IF;

  INSERT INTO public.clearance_tracking (newhire_id) VALUES (p_newhire_id)
    ON CONFLICT (newhire_id) DO NOTHING;

  UPDATE public.clearance_tracking SET
    package_stage    = p_to,
    stage_updated_at = v_now,
    stage_updated_by = p_actor_id,
    package_sent_at  = CASE WHEN p_to = 'needs_review' THEN v_now ELSE package_sent_at END,
    returned_note    = CASE WHEN p_to = 'returned' THEN left(trim(p_note), 1000)
                            WHEN p_to = 'needs_review' THEN NULL ELSE returned_note END,
    returned_at      = CASE WHEN p_to = 'returned' THEN v_now ELSE returned_at END,
    done_at          = CASE WHEN p_to = 'done' THEN v_now ELSE done_at END,
    updated_at       = v_now
  WHERE newhire_id = p_newhire_id
    AND package_stage IS NOT DISTINCT FROM v_from;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN 'conflict'; END IF;

  INSERT INTO public.clearance_stage_history (newhire_id, from_stage, to_stage, actor_id, note)
    VALUES (p_newhire_id, v_from, p_to, p_actor_id,
            CASE WHEN p_to = 'returned' THEN left(trim(p_note), 1000) ELSE NULL END);
  RETURN 'ok';
END; $$;
REVOKE EXECUTE ON FUNCTION public.move_clearance_stage(uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_clearance_stage(uuid, text, text, uuid, text) TO service_role;

-- ── 8. The 'clearance' role: profiles checks ─────────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('hr','newhire','stakeholder','payroll','manager','project_mgmt','clearance'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_roles_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_roles_valid CHECK (
  cardinality(roles) >= 1
  AND roles <@ ARRAY['hr','newhire','stakeholder','payroll','manager','project_mgmt','clearance']::text[]
  AND role = ANY(roles));

-- ── 9. The 'clearance' role: new accounts ────────────────────────────────────
-- (sync_roles_to_auth copies whatever is in profiles.role / roles and has no role list, so it is
-- unchanged.)
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text := coalesce(new.raw_app_meta_data->>'role', 'newhire');
BEGIN
  IF v_role NOT IN ('hr','newhire','stakeholder','payroll','manager','project_mgmt','clearance') THEN
    v_role := 'newhire';
  END IF;
  INSERT INTO public.profiles (id, full_name, aem_email, role, roles)
  VALUES (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email, v_role, ARRAY[v_role]);
  RETURN new;
END; $$;

-- ── 10. Reveal codes: allow the 'clearance' group (legal name, place of birth, DCN) ──
ALTER TABLE public.reveal_codes DROP CONSTRAINT IF EXISTS reveal_codes_grp_check;
ALTER TABLE public.reveal_codes ADD CONSTRAINT reveal_codes_grp_check CHECK (grp IN ('banking','sin','clearance'));

-- ── 11. Reveal codes: issue function accepts the new group (verify needs no change) ──
CREATE OR REPLACE FUNCTION public.issue_reveal_code(
  p_hr_user_id uuid, p_hire_id uuid, p_group text, p_code_hash text, p_ttl_seconds integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_group NOT IN ('banking', 'sin', 'clearance') OR p_ttl_seconds < 60 OR p_ttl_seconds > 900 THEN
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
REVOKE EXECUTE ON FUNCTION public.issue_reveal_code(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_reveal_code(uuid, uuid, text, text, integer) TO service_role;

-- ── 12. Reload ───────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── Verify (run each; expected results in comments) ──────────────────────────
-- SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='clearance_info';          -- 21
-- SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='clearance_tracking';      -- 21
-- SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='clearance_stage_history'; -- 7
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname IN ('profiles_role_check','profiles_roles_valid','reveal_codes_grp_check');
--   -- each lists 'clearance'
-- SELECT proname FROM pg_proc WHERE proname IN ('move_clearance_stage','issue_reveal_code','handle_new_user');  -- 3 rows
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'clearance_stage_history';                                 -- true
