-- =============================================================================
-- Steps Intranet — Allow re-applying after a soft-delete
-- Date: 2026-04-20
--
-- The original table constraint `unique (student_id, event_id)` in 0001 did
-- not account for soft-deleted rows (deleted_at IS NOT NULL). Students who
-- withdrew (or whose application was soft-deleted by an admin) hit a unique
-- constraint violation when trying to re-apply — surfacing as the misleading
-- "You have already submitted an application for this event." error.
--
-- Fix: drop the full constraint and replace with a partial unique index that
-- only applies to live rows. Soft-deleted rows stay in the table for audit
-- history but no longer block new submissions.
-- =============================================================================

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_student_id_event_id_key;

-- Some Postgres versions name the auto-generated constraint differently.
-- Drop any leftover named forms defensively.
ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_student_event_unique;

CREATE UNIQUE INDEX IF NOT EXISTS applications_student_event_live_uniq
  ON public.applications (student_id, event_id)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX public.applications_student_event_live_uniq IS
  'One live application per student per event. Soft-deleted rows are ignored so students can re-apply after a withdrawal or admin soft-delete.';
