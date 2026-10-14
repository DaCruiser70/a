-- Manager onboarding plans and the notification outbox.
-- Already run in the Supabase SQL editor; saved here for the record. Safe to re-run.
-- NOTE: reconstructed from the column list in Prompt B. Compare with the SQL that was
-- actually run (nullability, defaults and indexes are marked below) and keep that version
-- if they differ.

CREATE TABLE IF NOT EXISTS public.manager_plans (
  id                uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  newhire_id        uuid        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  manager_id        uuid        NOT NULL REFERENCES public.managers(id),
  status            text        NOT NULL DEFAULT 'requested'
                                CHECK (status IN ('requested','draft','submitted')),
  due_date          date,
  -- answers: all nullable so a draft may leave any of them empty
  training_needed   text,
  training_delivery text[]      NOT NULL DEFAULT '{}',
  training_notes    text,
  week1             text,
  week2             text,
  week3             text,
  day_one_contact   text,
  first_day_gear    text,
  anything_else     text,
  clearance_type    text        NOT NULL DEFAULT 'none'
                                CHECK (clearance_type IN ('none','rcmp','pspc_rcmp')),
  project_number    text,
  project_name      text,
  project_region    text        CHECK (project_region IN ('Ontario','New Brunswick','Nova Scotia')),
  project_location  text,
  project_branch    text,
  submitted_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- newhire_id is indexed by its UNIQUE constraint
CREATE INDEX IF NOT EXISTS idx_manager_plans_manager  ON public.manager_plans(manager_id);
CREATE INDEX IF NOT EXISTS idx_manager_plans_status   ON public.manager_plans(status);
CREATE INDEX IF NOT EXISTS idx_manager_plans_due_date ON public.manager_plans(due_date);
ALTER TABLE public.manager_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manager_plans FROM anon, authenticated;
GRANT ALL ON public.manager_plans TO service_role;

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  dedupe_key  text        NOT NULL UNIQUE,
  to_emails   text[]      NOT NULL,
  template    text        NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','sent','failed')),
  attempts    integer     NOT NULL DEFAULT 0,
  last_error  text,
  send_after  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
-- dedupe_key is indexed by its UNIQUE constraint
CREATE INDEX IF NOT EXISTS idx_outbox_status_send_after ON public.notification_outbox(status, send_after);
CREATE INDEX IF NOT EXISTS idx_outbox_template          ON public.notification_outbox(template);
CREATE INDEX IF NOT EXISTS idx_outbox_created_at        ON public.notification_outbox(created_at DESC);
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_outbox FROM anon, authenticated;
GRANT ALL ON public.notification_outbox TO service_role;

NOTIFY pgrst, 'reload schema';
