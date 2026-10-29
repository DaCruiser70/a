-- Regional project management: each region's team (who can sign in to the shared regional
-- account and receive its codes) and one project-management request per hire.
-- Already run in the Supabase SQL editor; saved here for the record. Safe to re-run.
-- NOTE: reconstructed from the column list in Prompt D. Compare with the SQL that was actually
-- run (defaults, checks, the foreign keys on claimed_by / completed_by, and indexes are marked
-- below) and keep that version if they differ.

CREATE TABLE IF NOT EXISTS public.region_teams (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  region        text        NOT NULL CHECK (region IN ('Ontario','New Brunswick','Nova Scotia')),
  member_name   text        NOT NULL,
  member_email  text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- One entry per person per region, case-insensitive on the email
CREATE UNIQUE INDEX IF NOT EXISTS region_teams_region_email_key ON public.region_teams(region, lower(member_email));
CREATE INDEX IF NOT EXISTS idx_region_teams_region_active ON public.region_teams(region, active);
ALTER TABLE public.region_teams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.region_teams FROM anon, authenticated;
GRANT ALL ON public.region_teams TO service_role;

CREATE TABLE IF NOT EXISTS public.pm_requests (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  newhire_id    uuid        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  region        text        NOT NULL CHECK (region IN ('Ontario','New Brunswick','Nova Scotia')),
  status        text        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','claimed','done','cancelled')),
  -- actions are attributed to the team member signed in on the shared account
  claimed_by    uuid        REFERENCES public.region_teams(id),
  claimed_at    timestamptz,
  completed_by  uuid        REFERENCES public.region_teams(id),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- newhire_id is indexed by its UNIQUE constraint
CREATE INDEX IF NOT EXISTS idx_pm_requests_region_status ON public.pm_requests(region, status);
CREATE INDEX IF NOT EXISTS idx_pm_requests_claimed_by    ON public.pm_requests(claimed_by);
CREATE INDEX IF NOT EXISTS idx_pm_requests_completed_by  ON public.pm_requests(completed_by);
ALTER TABLE public.pm_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pm_requests FROM anon, authenticated;
GRANT ALL ON public.pm_requests TO service_role;

NOTIFY pgrst, 'reload schema';
