-- Company vehicle requests: Rob → Heather → Marley (insurance). NOT run yet.
-- Run each numbered step on its own in the Supabase SQL editor, in order. Safe to re-run.
--
-- One row per hire's vehicle request. The vehicle details are one encrypted JSON blob
-- (lib/encrypt.ts, the same helper as the stakeholder completion notes); only the server decrypts.
-- Who does each step is not stored here: lib/stakeholder-mapping.ts (VEHICLE_STEP_EMAILS) names the
-- three stakeholder accounts. The stakeholder_tasks rows each person sees are created one at a time,
-- only when their step starts. Nothing is dropped; old Gas Card and old three-person vehicle tasks
-- stay as they are.

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_requests (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  newhire_id           uuid        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  step                 text        NOT NULL DEFAULT 'rob' CHECK (step IN ('rob','heather','marley','complete')),
  details_enc          text,
  gas_card_acquired    boolean,
  rob_completed_by     uuid        REFERENCES public.profiles(id),
  rob_completed_at     timestamptz,
  heather_completed_by uuid        REFERENCES public.profiles(id),
  heather_completed_at timestamptz,
  marley_confirmed_by  uuid        REFERENCES public.profiles(id),
  marley_confirmed_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Indexes (newhire_id is indexed by its UNIQUE constraint) ──────────────
CREATE INDEX IF NOT EXISTS idx_vehicle_requests_step       ON public.vehicle_requests(step);
CREATE INDEX IF NOT EXISTS idx_vehicle_requests_rob_by     ON public.vehicle_requests(rob_completed_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_requests_heather_by ON public.vehicle_requests(heather_completed_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_requests_marley_by  ON public.vehicle_requests(marley_confirmed_by);

-- ── 3. Access ────────────────────────────────────────────────────────────────
ALTER TABLE public.vehicle_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_requests FROM anon, authenticated;
GRANT ALL ON public.vehicle_requests TO service_role;

-- ── 4. Start a request: the row (step 'rob') and Rob's task, together ───────
-- Returns true only when this call created the request (a second call does nothing).
CREATE OR REPLACE FUNCTION public.start_vehicle_request(
  p_newhire_id uuid, p_rob_id uuid, p_task_name text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows integer;
BEGIN
  INSERT INTO public.vehicle_requests (newhire_id, step) VALUES (p_newhire_id, 'rob')
    ON CONFLICT (newhire_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stakeholder_tasks
                 WHERE newhire_id = p_newhire_id AND assigned_to = p_rob_id AND task_key = 'vehicle') THEN
    INSERT INTO public.stakeholder_tasks (newhire_id, assigned_to, task_key, task_name, status)
      VALUES (p_newhire_id, p_rob_id, 'vehicle', p_task_name, 'pending');
  END IF;
  RETURN true;
END; $$;

-- ── 5. Advance one step: one atomic call ─────────────────────────────────────
-- Applies only WHERE step = p_expected, so a double click or a second tab gets 'conflict'.
-- rob → heather and heather → marley save the details; marley → complete changes no details.
-- Confirms the actor's own task and creates the next person's task (if any) in the same call.
CREATE OR REPLACE FUNCTION public.advance_vehicle_request(
  p_newhire_id uuid, p_expected text, p_actor_id uuid,
  p_details_enc text, p_gas_card boolean,
  p_next_assignee uuid, p_next_task_key text, p_next_task_name text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now  timestamptz := now();
  v_rows integer;
  v_task text := CASE WHEN p_expected = 'marley' THEN 'vehicle_insurance' ELSE 'vehicle' END;
BEGIN
  IF p_expected NOT IN ('rob','heather','marley') THEN RETURN 'invalid'; END IF;

  UPDATE public.vehicle_requests SET
    step                 = CASE p_expected WHEN 'rob' THEN 'heather' WHEN 'heather' THEN 'marley' ELSE 'complete' END,
    details_enc          = CASE WHEN p_expected = 'marley' THEN details_enc ELSE p_details_enc END,
    gas_card_acquired    = CASE WHEN p_expected = 'marley' THEN gas_card_acquired ELSE p_gas_card END,
    rob_completed_by     = CASE WHEN p_expected = 'rob'     THEN p_actor_id ELSE rob_completed_by END,
    rob_completed_at     = CASE WHEN p_expected = 'rob'     THEN v_now      ELSE rob_completed_at END,
    heather_completed_by = CASE WHEN p_expected = 'heather' THEN p_actor_id ELSE heather_completed_by END,
    heather_completed_at = CASE WHEN p_expected = 'heather' THEN v_now      ELSE heather_completed_at END,
    marley_confirmed_by  = CASE WHEN p_expected = 'marley'  THEN p_actor_id ELSE marley_confirmed_by END,
    marley_confirmed_at  = CASE WHEN p_expected = 'marley'  THEN v_now      ELSE marley_confirmed_at END,
    updated_at           = v_now
  WHERE newhire_id = p_newhire_id AND step = p_expected;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN 'conflict'; END IF;

  UPDATE public.stakeholder_tasks SET status = 'confirmed', confirmed_at = v_now
    WHERE newhire_id = p_newhire_id AND assigned_to = p_actor_id AND task_key = v_task AND status = 'pending';

  IF p_next_assignee IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.stakeholder_tasks
    WHERE newhire_id = p_newhire_id AND assigned_to = p_next_assignee AND task_key = p_next_task_key
  ) THEN
    INSERT INTO public.stakeholder_tasks (newhire_id, assigned_to, task_key, task_name, status)
      VALUES (p_newhire_id, p_next_assignee, p_next_task_key, p_next_task_name, 'pending');
  END IF;
  RETURN 'ok';
END; $$;

-- ── 6. Function permissions ──────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.start_vehicle_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.advance_vehicle_request(uuid, text, uuid, text, boolean, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_vehicle_request(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_vehicle_request(uuid, text, uuid, text, boolean, uuid, text, text) TO service_role;

-- ── 7. Reload ────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── 8. OPTIONAL (test data): stop showing Morley's old vehicle tasks ─────────
-- Hires that already had the old three-person vehicle approval keep their old tasks (nothing is
-- deleted, and they are not moved into the new flow). This only hides Morley's still-pending old
-- vehicle tasks from his task screen; HR still sees them. Check the email first:
--   SELECT id, full_name FROM public.profiles WHERE aem_email ILIKE 'mnorman@aemltd.com';
UPDATE public.stakeholder_tasks SET hidden_from_stakeholder = true
WHERE task_key = 'vehicle' AND status = 'pending'
  AND assigned_to = (SELECT id FROM public.profiles WHERE aem_email ILIKE 'mnorman@aemltd.com')
  AND newhire_id NOT IN (SELECT newhire_id FROM public.vehicle_requests);

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicle_requests';  -- 13
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'vehicle_requests';                                          -- true
-- SELECT proname FROM pg_proc WHERE proname IN ('start_vehicle_request','advance_vehicle_request');               -- 2 rows
