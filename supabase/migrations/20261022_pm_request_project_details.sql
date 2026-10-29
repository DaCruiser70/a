-- Project details entered by regional project management on a request (Prompt M2).
-- Already run in the Supabase SQL editor; saved here for the record. Safe to re-run.
-- NOTE: written from the column list in Prompt M2. If the SQL that was actually run differs,
-- keep that version.

ALTER TABLE public.pm_requests ADD COLUMN IF NOT EXISTS dcc              text;
ALTER TABLE public.pm_requests ADD COLUMN IF NOT EXISTS standing_offer   text;
ALTER TABLE public.pm_requests ADD COLUMN IF NOT EXISTS project_name     text;
ALTER TABLE public.pm_requests ADD COLUMN IF NOT EXISTS project_location text;

NOTIFY pgrst, 'reload schema';
