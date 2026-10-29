-- Drop the old manager plan answers (Prompt M2). NOT run yet.
-- Run this only AFTER the new code is deployed and tested: the previous code still reads these.
--
-- Checked before writing: no app code, SQL function (reassign_manager_plan uses only newhire_id,
-- manager_id, status, due_date, assignment_seq), view or other migration uses these columns.
-- All current data in them is test data.
--
-- manager_plans goes from 31 columns to 22.

ALTER TABLE public.manager_plans
  DROP COLUMN IF EXISTS training_needed,
  DROP COLUMN IF EXISTS training_delivery,
  DROP COLUMN IF EXISTS training_notes,
  DROP COLUMN IF EXISTS week1,
  DROP COLUMN IF EXISTS week2,
  DROP COLUMN IF EXISTS week3,
  DROP COLUMN IF EXISTS project_name,
  DROP COLUMN IF EXISTS project_location,
  DROP COLUMN IF EXISTS project_branch;

NOTIFY pgrst, 'reload schema';

-- Check (expect 22):
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'manager_plans';
