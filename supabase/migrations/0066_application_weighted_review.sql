-- 0066_application_weighted_review.sql
-- Weighted shortlisting score for the applicants table. Stores a 0-100 score
-- (strongest candidate in the cohort = 100) plus its component breakdown, as
-- JSONB. Distinct from ai_review (1-5): this blends the selection-test result
-- (contextualised within school type), the AI application-quality score, need/
-- context signals (FSM, first-gen, IMD, POLAR4, income, school type) and
-- engagement. Admin-only — never shown to students (same pattern as ai_review
-- / internal_review_status; student-facing queries use explicit column lists).
-- The per-round scores themselves are written by an admin data pass, not this
-- migration (this only adds the column).
alter table public.applications
  add column if not exists weighted_review jsonb;

comment on column public.applications.weighted_review is
  'Admin-only weighted shortlisting score (0-100, best candidate = 100) + component breakdown. Computed per selection round. Never shown to students.';
