-- 0021_candidate_internal_review.sql
-- Adds internal-only review state for candidates so reviewers can mark
-- shortlist/accept/waitlist/reject intentions BEFORE committing the
-- student-facing status (which fires a notification).
--
-- Also: adds a student self-select policy for application_status_history
-- so the Student Hub can derive a "journey-aware" label
-- (e.g. "Waitlisted · Unsuccessful" when they were waitlisted then rejected).
--
-- Applied to live DB 2026-04-23 (project rvspshqltnyormiqaidx).

-- 1. Internal review columns on applications.
--    NOT exposed via applications_wider view; student-facing code (hub-api.ts
--    et al) MUST NOT include this column in .select() lists. Same discipline
--    as review_notes.
alter table public.applications
  add column if not exists internal_review_status text
    check (internal_review_status is null or internal_review_status in
           ('accept','shortlist','waitlist','reject'));

alter table public.applications
  add column if not exists internal_review_at timestamptz;

alter table public.applications
  add column if not exists internal_review_by uuid
    references public.team_members(auth_uuid);

comment on column public.applications.internal_review_status is
  'Admin-only draft review state. Never shown to students. Cleared when a
   matching committed decision (applications.status) is made.';

create index if not exists applications_internal_review_idx
  on public.applications (internal_review_status)
  where internal_review_status is not null;

-- 2. Student self-select on application_status_history so the journey-aware
--    label can read it. Students can read history rows for their own apps
--    only. Admin policy unchanged.
drop policy if exists app_status_history_self_select on public.application_status_history;
create policy app_status_history_self_select on public.application_status_history
  for select to authenticated
  using (
    application_id in (
      select a.id from public.applications a
      join public.students s on s.id = a.student_id
      where s.personal_email = lower(auth.jwt() ->> 'email')
        and a.deleted_at is null
    )
  );

-- 3. Extend email_templates.type to include 'shortlist' (and preserve 'invite',
--    which is already in production use).
alter table public.email_templates drop constraint if exists email_templates_type_check;
alter table public.email_templates add constraint email_templates_type_check
  check (type in ('acceptance','rejection','waitlist','shortlist',
                  'invite','reminder','follow_up','custom'));

-- 4. Seed shortlist email template (generic, merge-tag-friendly, matches
--    the voice of the existing acceptance/rejection/waitlist seeds).
insert into public.email_templates (name, type, subject, body_html, event_id)
select 'Default shortlist', 'shortlist',
  E'You''ve been shortlisted for {{event_name}}',
  E'Hi {{first_name}},\n\nGreat news — your application to {{event_name}} has been shortlisted.\n\nWe''ll be in touch shortly with next steps. In the meantime, keep an eye on {{portal_link}}.\n\nThank you for applying, and we''re looking forward to the next stage.\n\nVirtus non origo,\nThe Steps Foundation Team',
  null
where not exists (
  select 1 from public.email_templates
  where name = 'Default shortlist' and event_id is null and deleted_at is null
);
