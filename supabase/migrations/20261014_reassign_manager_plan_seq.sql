-- Reassigning a hire back to a former manager must notify that manager again.
-- Requires manager_plans.assignment_seq integer NOT NULL DEFAULT 1 (already added).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Replaces reassign_manager_plan. Every real change of manager now increments assignment_seq in
-- the same transaction, and the function returns it so the app can build the notification dedupe
-- key manager_plan_request:{hireId}:{managerId}:{assignment_seq}. Choosing the manager the plan
-- already has changes nothing and returns 'unchanged', so no new request is queued.
--
-- The return type changes (text → table), which CREATE OR REPLACE cannot do, so the old function
-- is dropped and recreated inside one transaction. Deploy the matching app code at the same time:
-- the previous code expects a plain text result.
--
-- Returns one row: (outcome, assignment_seq)
--   outcome: 'ok' | 'unchanged' | 'no_hire' | 'no_manager'
--   assignment_seq: the plan's sequence after the call (null for 'no_hire' / 'no_manager')

BEGIN;

DROP FUNCTION IF EXISTS public.reassign_manager_plan(uuid, uuid);

CREATE FUNCTION public.reassign_manager_plan(p_newhire_id uuid, p_manager_id uuid)
RETURNS TABLE (outcome text, assignment_seq integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  m        public.managers%ROWTYPE;
  v_due    date;
  v_old    uuid;
  v_seq    integer;
BEGIN
  -- Lock the hire so concurrent reassignments of the same hire run one after the other
  SELECT form_deadline INTO v_due FROM public.profiles
    WHERE id = p_newhire_id AND 'newhire' = ANY(roles)
    FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'no_hire'::text, NULL::integer; RETURN; END IF;

  SELECT * INTO m FROM public.managers WHERE id = p_manager_id AND active;
  IF NOT FOUND THEN RETURN QUERY SELECT 'no_manager'::text, NULL::integer; RETURN; END IF;

  SELECT mp.manager_id, mp.assignment_seq INTO v_old, v_seq
    FROM public.manager_plans mp WHERE mp.newhire_id = p_newhire_id
    FOR UPDATE;

  IF FOUND THEN
    -- Same manager: the open request stands; nothing changes and nothing new is queued
    IF v_old = p_manager_id THEN
      RETURN QUERY SELECT 'unchanged'::text, v_seq;
      RETURN;
    END IF;

    -- A new assignment (including back to a former manager): new sequence, every answer kept
    UPDATE public.manager_plans mp
       SET manager_id = p_manager_id, assignment_seq = mp.assignment_seq + 1, updated_at = now()
     WHERE mp.newhire_id = p_newhire_id
     RETURNING mp.assignment_seq INTO v_seq;
  ELSE
    -- No plan yet (a hire that predates manager plans): the first assignment
    INSERT INTO public.manager_plans (newhire_id, manager_id, status, due_date, assignment_seq)
    VALUES (p_newhire_id, p_manager_id, 'requested', v_due, 1)
    RETURNING manager_plans.assignment_seq INTO v_seq;
  END IF;

  UPDATE public.profiles
  SET reporting_manager_id    = m.id,
      reporting_manager_name  = m.full_name,
      reporting_manager_email = m.email,
      updated_at              = now()
  WHERE id = p_newhire_id;

  RETURN QUERY SELECT 'ok'::text, v_seq;
END; $$;

-- Server only: callable by the service role, never by anon or signed-in users
REVOKE EXECUTE ON FUNCTION public.reassign_manager_plan(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_manager_plan(uuid, uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
