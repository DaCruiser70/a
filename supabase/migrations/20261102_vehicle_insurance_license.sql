-- Company vehicle: Marley's insurance step waits for the Driver's License (Prompt V2). NOT run yet.
-- Run each numbered statement on its own in the Supabase SQL editor, in order. Safe to re-run.
--
-- Already in place from 20261028_vehicle_requests.sql: the 'marley' and 'complete' steps and the
-- marley_confirmed_by / marley_confirmed_at columns (re-added below with IF NOT EXISTS, harmless).
-- New here:
--   'license'    Heather has completed; Marley's step starts once the hire's Driver's License is
--                uploaded AND approved by HR (start_vehicle_insurance)
--   'cancelled'  HR untick Company Vehicle before the request was complete (cancel_vehicle_request)
-- Nothing is deleted. Requests already 'complete' stay complete.

-- 1. Marley's columns (no-op where they exist)
ALTER TABLE public.vehicle_requests ADD COLUMN IF NOT EXISTS marley_confirmed_by uuid REFERENCES public.profiles(id);

-- 2.
ALTER TABLE public.vehicle_requests ADD COLUMN IF NOT EXISTS marley_confirmed_at timestamptz;

-- 3. The step values, in order (the old constraint is replaced)
ALTER TABLE public.vehicle_requests DROP CONSTRAINT IF EXISTS vehicle_requests_step_check;

-- 4.
ALTER TABLE public.vehicle_requests ADD CONSTRAINT vehicle_requests_step_check
  CHECK (step IN ('rob', 'heather', 'license', 'marley', 'complete', 'cancelled'));

-- 5. Index for Marley's column (no-op where it exists)
CREATE INDEX IF NOT EXISTS idx_vehicle_requests_marley_by ON public.vehicle_requests(marley_confirmed_by);

-- 6. Advance one step. Same as before except: Heather now moves the request to 'license' (Marley's
-- task is created by start_vehicle_insurance, not here), and a next person's task that already
-- exists (a restarted request) is reopened instead of skipped.
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
    step                 = CASE p_expected WHEN 'rob' THEN 'heather' WHEN 'heather' THEN 'license' ELSE 'complete' END,
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

  IF p_next_assignee IS NOT NULL THEN
    UPDATE public.stakeholder_tasks SET status = 'pending', confirmed_at = NULL, hidden_from_stakeholder = false
      WHERE newhire_id = p_newhire_id AND assigned_to = p_next_assignee AND task_key = p_next_task_key;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      INSERT INTO public.stakeholder_tasks (newhire_id, assigned_to, task_key, task_name, status)
        VALUES (p_newhire_id, p_next_assignee, p_next_task_key, p_next_task_name, 'pending');
    END IF;
  END IF;
  RETURN 'ok';
END; $$;

-- 7. Start Marley's insurance step: one conditional UPDATE that needs BOTH Heather's step done
-- (step = 'license') AND the hire's Driver's License approved. Called after Heather completes and
-- after HR approves a document; whichever happens last starts it. A second call finds the step
-- already 'marley' and does nothing, so there is never a second task. Returns true only for the
-- call that started it.
CREATE OR REPLACE FUNCTION public.start_vehicle_insurance(
  p_newhire_id uuid, p_marley_id uuid, p_task_name text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE public.vehicle_requests SET step = 'marley', updated_at = now()
    WHERE newhire_id = p_newhire_id AND step = 'license'
      AND EXISTS (SELECT 1 FROM public.newhire_documents d
                  WHERE d.user_id = p_newhire_id AND d.document_type = 'drivers_license' AND d.form_status = 'approved');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN false; END IF;

  UPDATE public.stakeholder_tasks SET status = 'pending', confirmed_at = NULL, hidden_from_stakeholder = false
    WHERE newhire_id = p_newhire_id AND assigned_to = p_marley_id AND task_key = 'vehicle_insurance';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    INSERT INTO public.stakeholder_tasks (newhire_id, assigned_to, task_key, task_name, status)
      VALUES (p_newhire_id, p_marley_id, 'vehicle_insurance', p_task_name, 'pending');
  END IF;
  RETURN true;
END; $$;

-- 8. Cancel: HR unticked Company Vehicle. An unfinished request becomes 'cancelled' and its still-
-- pending tasks are hidden from Rob, Heather and Marley (kept for HR's history; nothing deleted).
-- A complete request is left alone. Returns true only when this call cancelled it.
CREATE OR REPLACE FUNCTION public.cancel_vehicle_request(p_newhire_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE public.vehicle_requests SET step = 'cancelled', updated_at = now()
    WHERE newhire_id = p_newhire_id AND step NOT IN ('complete', 'cancelled');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN false; END IF;
  UPDATE public.stakeholder_tasks SET hidden_from_stakeholder = true
    WHERE newhire_id = p_newhire_id AND task_key IN ('vehicle', 'vehicle_insurance') AND status = 'pending';
  RETURN true;
END; $$;

-- 9. Start a request. Same as before, plus: ticking Company Vehicle again after a cancel restarts
-- the cancelled request at Rob (the saved details stay as his starting point; the three sign-offs
-- are cleared) and reopens Rob's task.
CREATE OR REPLACE FUNCTION public.start_vehicle_request(
  p_newhire_id uuid, p_rob_id uuid, p_task_name text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows integer;
BEGIN
  INSERT INTO public.vehicle_requests (newhire_id, step) VALUES (p_newhire_id, 'rob')
    ON CONFLICT (newhire_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    UPDATE public.vehicle_requests SET step = 'rob',
        rob_completed_by = NULL, rob_completed_at = NULL,
        heather_completed_by = NULL, heather_completed_at = NULL,
        marley_confirmed_by = NULL, marley_confirmed_at = NULL,
        updated_at = now()
      WHERE newhire_id = p_newhire_id AND step = 'cancelled';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RETURN false; END IF;
    UPDATE public.stakeholder_tasks SET status = 'pending', confirmed_at = NULL, hidden_from_stakeholder = false
      WHERE newhire_id = p_newhire_id AND assigned_to = p_rob_id AND task_key = 'vehicle';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN RETURN true; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stakeholder_tasks
                 WHERE newhire_id = p_newhire_id AND assigned_to = p_rob_id AND task_key = 'vehicle') THEN
    INSERT INTO public.stakeholder_tasks (newhire_id, assigned_to, task_key, task_name, status)
      VALUES (p_newhire_id, p_rob_id, 'vehicle', p_task_name, 'pending');
  END IF;
  RETURN true;
END; $$;

-- 10-15. Function permissions: service role only
REVOKE EXECUTE ON FUNCTION public.start_vehicle_insurance(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_vehicle_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.advance_vehicle_request(uuid, text, uuid, text, boolean, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_vehicle_insurance(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_vehicle_request(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_vehicle_request(uuid, text, uuid, text, boolean, uuid, text, text) TO service_role;

-- 16. (start_vehicle_request keeps its grants from 20261028; repeated here, harmless)
REVOKE EXECUTE ON FUNCTION public.start_vehicle_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- 17.
GRANT EXECUTE ON FUNCTION public.start_vehicle_request(uuid, uuid, text) TO service_role;

-- 18. RLS and grants are unchanged (still locked down); repeated so a fresh database matches
ALTER TABLE public.vehicle_requests ENABLE ROW LEVEL SECURITY;

-- 19.
REVOKE ALL ON public.vehicle_requests FROM anon, authenticated;

-- 20.
GRANT ALL ON public.vehicle_requests TO service_role;

-- 21. Test data already at Marley's step from before this change, whose licence is NOT approved:
-- put them back to "waiting on the licence" and hide Marley's open task. When HR approves the
-- licence, start_vehicle_insurance reopens it. Requests already 'complete' are not touched.
-- (Optional, but recommended. Run the SELECT first to see how many rows it affects.)
--   SELECT count(*) FROM public.vehicle_requests v WHERE v.step = 'marley' AND NOT EXISTS (
--     SELECT 1 FROM public.newhire_documents d WHERE d.user_id = v.newhire_id AND d.document_type = 'drivers_license' AND d.form_status = 'approved');
UPDATE public.stakeholder_tasks t SET hidden_from_stakeholder = true
  WHERE t.task_key = 'vehicle_insurance' AND t.status = 'pending'
    AND t.newhire_id IN (SELECT v.newhire_id FROM public.vehicle_requests v WHERE v.step = 'marley' AND NOT EXISTS (
      SELECT 1 FROM public.newhire_documents d WHERE d.user_id = v.newhire_id AND d.document_type = 'drivers_license' AND d.form_status = 'approved'));

-- 22. (the second half of 21; run right after it)
UPDATE public.vehicle_requests v SET step = 'license', updated_at = now()
  WHERE v.step = 'marley' AND NOT EXISTS (
    SELECT 1 FROM public.newhire_documents d WHERE d.user_id = v.newhire_id AND d.document_type = 'drivers_license' AND d.form_status = 'approved');

-- 23.
NOTIFY pgrst, 'reload schema';

-- Verify (expect: 13 | true | 4 | 1):
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vehicle_requests') AS columns,
--   (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.vehicle_requests'::regclass) AS rls_on,
--   (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--      AND proname IN ('start_vehicle_request', 'advance_vehicle_request', 'start_vehicle_insurance', 'cancel_vehicle_request')) AS functions,
--   (SELECT count(*) FROM pg_constraint WHERE conname = 'vehicle_requests_step_check'
--      AND pg_get_constraintdef(oid) LIKE '%license%' AND pg_get_constraintdef(oid) LIKE '%cancelled%') AS step_check;
