-- ---------------------------------------------------------------------------
-- 0060_external_screening_passed.sql
--
-- Enables the EXTERNAL (student-facing) 'screening_passed' status. 0059's
-- comment assumed applications.status was app-enforced only, but the
-- applications_status_fkey to application_statuses is real — the missing
-- lookup row is why every screening status write was silently rejected.
--
-- Model (Sam, 2026-06-12):
--  * EXTERNAL 'screening_passed' = student-visible stage; carries online
--    test access (clicking the test link works). Set via Pass screening
--    bulk actions; the day-one email is a status update, the test link
--    comes later.
--  * INTERNAL 'screening_passed' mark (0049) = team-only staging; NO test
--    access. Either form lands the applicant in the Screening passed tab.
-- Applied via Supabase MCP at the same time this file landed in git.
-- ---------------------------------------------------------------------------

insert into public.application_statuses (code, label, is_terminal, sort_order)
values ('screening_passed', 'Screening passed', false, 15)
on conflict (code) do nothing;
