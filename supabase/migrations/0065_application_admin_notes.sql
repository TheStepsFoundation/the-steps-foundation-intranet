-- 0065_application_admin_notes.sql
-- Admin-only free-text commentary on an application, used during shortlisting.
-- Stores rich HTML produced by the shared RichTextEmailEditor (same editor as
-- the email composer). NEVER shown to students: applicant reads are gated by
-- RLS to is_admin() OR own-email, and every student-facing query selects an
-- explicit column list that excludes admin_notes (consistent with the existing
-- admin-only columns internal_review_status / ai_review / decision_reason).
alter table public.applications
  add column if not exists admin_notes text;

comment on column public.applications.admin_notes is
  'Admin-only rich-text (HTML) commentary for shortlisting/review. Never shown to students.';
