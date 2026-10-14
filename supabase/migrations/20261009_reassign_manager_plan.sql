-- Atomic manager reassignment for a hire: moves the plan (or opens one for a hire that
-- predates manager plans) and updates the profile's manager columns from the directory,
-- in one transaction. Every plan answer is kept.
-- Run once in the Supabase SQL editor, after 20261009_manager_plans_outbox.sql. Safe to re-run.
--
-- Returns: 'ok' | 'unchanged' | 'no_hire' | 'no_manager'

CREATE OR REPLACE FUNCTION public.reassign_manager_plan(p_newhire_id uuid, p_manager_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m        public.managers%ROWTYPE;
  v_due    date;
  v_old    uuid;
BEGIN
  SELECT form_deadline INTO v_due FROM public.profiles
    WHERE id = p_newhire_id AND 'newhire' = ANY(roles)
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'no_hire'; END IF;

  SELECT * INTO m FROM public.managers WHERE id = p_manager_id AND active;
  IF NOT FOUND THEN RETURN 'no_manager'; END IF;

  SELECT manager_id INTO v_old FROM public.manager_plans WHERE newhire_id = p_newhire_id FOR UPDATE;
  IF FOUND AND v_old = p_manager_id THEN RETURN 'unchanged'; END IF;

  INSERT INTO public.manager_plans (newhire_id, manager_id, status, due_date)
  VALUES (p_newhire_id, p_manager_id, 'requested', v_due)
  ON CONFLICT (newhire_id) DO UPDATE SET manager_id = EXCLUDED.manager_id, updated_at = now();

  UPDATE public.profiles
  SET reporting_manager_id    = m.id,
      reporting_manager_name  = m.full_name,
      reporting_manager_email = m.email,
      updated_at              = now()
  WHERE id = p_newhire_id;

  RETURN 'ok';
END; $$;

REVOKE EXECUTE ON FUNCTION public.reassign_manager_plan(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_manager_plan(uuid, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
