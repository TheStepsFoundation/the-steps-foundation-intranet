-- ---------------------------------------------------------------------------
-- 0059_screening_passed_test_invite.sql
--
-- Online-test screening flow (first use: Step Inside: Man Group):
--  * applications.status gains the app-level value 'screening_passed' —
--    "passed the initial eligibility/grades screen and invited to the online
--    selection test". Pre-shortlist: the shortlist (capacity × 1.5) is drawn
--    AFTER test results. applications.status has no CHECK constraint
--    (statuses are app-enforced via src/lib/application-status.ts), so this
--    is documentation-only at the DB level.
--  * email_templates.type gains 'test_invite' for the "Pass Screening &
--    Notify" composer flow, which also upserts test_invitations rows for all
--    recipients when the emails are queued.
-- Applied via Supabase MCP at the same time this file landed in git.
-- ---------------------------------------------------------------------------

alter table public.email_templates drop constraint email_templates_type_check;
alter table public.email_templates add constraint email_templates_type_check
  check (type = any (array[
    'acceptance','rejection','waitlist','shortlist','invite','test_invite',
    'reminder','follow_up','custom'
  ]::text[]));

comment on column public.applications.status is
  'App-enforced (no CHECK): submitted | screening_passed | shortlisted | accepted | waitlist | rejected | withdrew | ineligible. screening_passed = passed initial screening, invited to the online selection test (pre-shortlist). See src/lib/application-status.ts.';
