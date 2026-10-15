-- Security clearance: the hire's form (clearance_info), HR's tracker (clearance_tracking),
-- and the two storage buckets.
-- Already run in the Supabase SQL editor; saved here for the record. Safe to re-run.
-- NOTE: reconstructed from the column list in Prompt C. Compare with the SQL that was actually
-- run (nullability, defaults, checks, indexes and the storage policies are marked below) and keep
-- that version if they differ.

CREATE TABLE IF NOT EXISTS public.clearance_info (
  id                 uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            uuid        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- AES-256-GCM ciphertext from lib/encrypt.ts; decrypted server-side only
  legal_name_enc     text,
  place_of_birth_enc text,
  dcn_enc            text,
  -- storage paths in clearance-files: {user_id}/fingerprint.{ext}, {user_id}/rcmp.{ext}
  fingerprint_path   text,
  fingerprint_name   text,
  rcmp_path          text,
  rcmp_name          text,
  form_status        text        NOT NULL DEFAULT 'pending'
                                 CHECK (form_status IN ('pending','review','approved','flagged')),
  flag_reason        text,
  submitted_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- user_id is indexed by its UNIQUE constraint
CREATE INDEX IF NOT EXISTS idx_clearance_info_status ON public.clearance_info(form_status);
ALTER TABLE public.clearance_info ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clearance_info FROM anon, authenticated;
GRANT ALL ON public.clearance_info TO service_role;

CREATE TABLE IF NOT EXISTS public.clearance_tracking (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  newhire_id      uuid        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  pspc_sent_at    timestamptz,
  pspc_sent_by    uuid        REFERENCES public.profiles(id),
  rcmp_sent_at    timestamptz,
  rcmp_sent_by    uuid        REFERENCES public.profiles(id),
  rcmp_recipient  text,
  cleared_at      timestamptz,
  cleared_by      uuid        REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- newhire_id is indexed by its UNIQUE constraint
CREATE INDEX IF NOT EXISTS idx_clearance_tracking_pspc_by    ON public.clearance_tracking(pspc_sent_by);
CREATE INDEX IF NOT EXISTS idx_clearance_tracking_rcmp_by    ON public.clearance_tracking(rcmp_sent_by);
CREATE INDEX IF NOT EXISTS idx_clearance_tracking_cleared_by ON public.clearance_tracking(cleared_by);
ALTER TABLE public.clearance_tracking ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clearance_tracking FROM anon, authenticated;
GRANT ALL ON public.clearance_tracking TO service_role;

-- ── Storage ──────────────────────────────────────────────────────────────────
-- Both buckets are private. clearance-templates holds fingerprint-form.pdf and rcmp-form.xlsx,
-- uploaded by an administrator and read only through 60-second signed URLs.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('clearance-files',     'clearance-files',     false),
  ('clearance-templates', 'clearance-templates', false)
ON CONFLICT (id) DO NOTHING;

-- The hire's browser uploads straight into clearance-files/{their user id}/ (as with void-cheques).
-- upsert needs INSERT, SELECT and UPDATE on the hire's own folder. Nothing else is granted:
-- reads for HR go through the service role and signed URLs.
DROP POLICY IF EXISTS "clearance files: own folder insert" ON storage.objects;
CREATE POLICY "clearance files: own folder insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'clearance-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "clearance files: own folder select" ON storage.objects;
CREATE POLICY "clearance files: own folder select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'clearance-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "clearance files: own folder update" ON storage.objects;
CREATE POLICY "clearance files: own folder update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'clearance-files' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'clearance-files' AND (storage.foldername(name))[1] = auth.uid()::text);

NOTIFY pgrst, 'reload schema';
