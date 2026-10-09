-- Multi-role accounts, manager directory, and role mirroring into auth app_metadata.
-- Run once in the Supabase SQL editor, after 20261009_auth_hardening.sql. Safe to re-run.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('hr','newhire','stakeholder','payroll','manager','project_mgmt'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS roles text[] NOT NULL DEFAULT '{}';
UPDATE public.profiles SET roles = ARRAY[role] WHERE cardinality(roles) = 0;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_roles_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_roles_valid CHECK (
  cardinality(roles) >= 1
  AND roles <@ ARRAY['hr','newhire','stakeholder','payroll','manager','project_mgmt']::text[]
  AND role = ANY(roles));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS region text
  CHECK (region IN ('Ontario','New Brunswick','Nova Scotia'));

CREATE TABLE IF NOT EXISTS public.managers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_managers_user ON public.managers(user_id);
ALTER TABLE public.managers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.managers FROM anon, authenticated;
GRANT ALL ON public.managers TO service_role;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS reporting_manager_id uuid REFERENCES public.managers(id);
CREATE INDEX IF NOT EXISTS idx_profiles_reporting_manager ON public.profiles(reporting_manager_id);

CREATE OR REPLACE FUNCTION public.is_hr() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND 'hr' = ANY(roles));
$$;

-- the role comes only from server-controlled app_metadata, never from user-editable metadata
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text := coalesce(new.raw_app_meta_data->>'role', 'newhire');
BEGIN
  IF v_role NOT IN ('hr','newhire','stakeholder','payroll','manager','project_mgmt') THEN
    v_role := 'newhire';
  END IF;
  INSERT INTO public.profiles (id, full_name, aem_email, role, roles)
  VALUES (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email, v_role, ARRAY[v_role]);
  RETURN new;
END; $$;

-- mirror roles into auth app_metadata so the middleware needs no database lookup
CREATE OR REPLACE FUNCTION public.sync_roles_to_auth() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', NEW.role, 'roles', to_jsonb(NEW.roles))
  WHERE id = NEW.id;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.sync_roles_to_auth() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profiles_sync_roles ON public.profiles;
CREATE TRIGGER profiles_sync_roles AFTER INSERT OR UPDATE OF role, roles ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_roles_to_auth();
UPDATE public.profiles SET roles = roles;
NOTIFY pgrst, 'reload schema';
