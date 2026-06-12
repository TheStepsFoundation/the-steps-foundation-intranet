-- ---------------------------------------------------------------------------
-- 0049_internal_screening_passed.sql
--
-- 'screening_passed' becomes an INTERNAL review mark (admin-only draft state
-- on applications.internal_review_status). Per Sam (2026-06-10/12): passing
-- screening must be visible to the team — internal mark, filter tab, bulk
-- action — but must NEVER appear in the student-facing external status. The
-- application_statuses FK row for 'screening_passed' is deliberately NOT
-- added, so the committed status column can never take that value.
-- Applied via Supabase MCP at the same time this file landed in git.
-- ---------------------------------------------------------------------------

alter table public.applications drop constraint applications_internal_review_status_check;
alter table public.applications add constraint applications_internal_review_status_check
  check (internal_review_status is null or internal_review_status = any (array['screening_passed'::text, 'accept'::text, 'shortlist'::text, 'waitlist'::text, 'reject'::text]));
