-- Manager plan: safety training checklist and five schedule boxes (Prompt M1).
-- Already run in the Supabase SQL editor; saved here for the record. Safe to re-run.
-- NOTE: written from the column list in Prompt M1. If the SQL that was actually run differs,
-- keep that version.
--
-- Nothing is dropped: training_needed, training_delivery, training_notes, week1–week3,
-- project_name, project_location and project_branch keep their data. The app no longer
-- writes them; HR sees the old training and week answers read-only as "Earlier answer".

ALTER TABLE public.manager_plans ADD COLUMN IF NOT EXISTS training_items  text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.manager_plans ADD COLUMN IF NOT EXISTS training_other  text;
ALTER TABLE public.manager_plans ADD COLUMN IF NOT EXISTS schedule_wk1_2  text;
ALTER TABLE public.manager_plans ADD COLUMN IF NOT EXISTS schedule_wk2_3  text;
ALTER TABLE public.manager_plans ADD COLUMN IF NOT EXISTS schedule_wk3_4  text;
ALTER TABLE public.manager_plans ADD COLUMN IF NOT EXISTS schedule_month2 text;
ALTER TABLE public.manager_plans ADD COLUMN IF NOT EXISTS schedule_month3 text;

NOTIFY pgrst, 'reload schema';
