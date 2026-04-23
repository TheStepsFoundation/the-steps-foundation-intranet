-- 0024_students_profile_fields.sql
--
-- Promote three application fields into first-class student profile fields so
-- they persist across applications (no more copy/paste between events):
--   - gcse_results      text
--   - qualifications    jsonb  -- array of {grade, subject, qualType}
--   - additional_context text  -- "Any additional contextual information you'd like us to know"
--
-- Also clean up two columns that were speculatively added but never wired up
-- in the UI and have 0 non-null rows across 2155 students:
--   - pronouns
--   - care_experienced   (folded into "additional_context" per product call)
--
-- The public.students_wider view (0002) selects `pronouns`, so we drop it up
-- front and recreate it without pronouns at the end.
--
-- Backfill: for each student, populate the new columns from their most recent
-- non-deleted application's raw_response. Last-write-wins per Favour's decision
-- (2026-04-23). Modern field names use snake_case (verified against the 66
-- applications that exercised the current schema); older legacy forms used
-- free-text keys we don't try to salvage here.

begin;

-- Drop view so we can drop the pronouns column it selects
drop view if exists public.students_wider;

alter table public.students
  add column if not exists gcse_results text,
  add column if not exists qualifications jsonb,
  add column if not exists additional_context text;

-- Backfill from latest non-deleted application per student. For
-- additional_context we also accept `anything_else` from the previous
-- generation of the form (348 rows).
with latest as (
  select distinct on (student_id)
    student_id,
    raw_response ->> 'gcse_results'       as gcse_results,
    raw_response ->  'qualifications'     as qualifications,
    raw_response ->> 'additional_context' as additional_context,
    raw_response ->> 'anything_else'      as anything_else
  from public.applications
  where deleted_at is null
  order by student_id, submitted_at desc nulls last
)
update public.students s set
  gcse_results       = coalesce(s.gcse_results, latest.gcse_results),
  qualifications     = coalesce(s.qualifications, latest.qualifications),
  additional_context = coalesce(
                         s.additional_context,
                         latest.additional_context,
                         latest.anything_else
                       ),
  updated_at         = now()
from latest
where latest.student_id = s.id;

-- Drop dormant columns (0/2155 rows populated as of 2026-04-23)
alter table public.students
  drop column if exists pronouns,
  drop column if exists care_experienced;

-- Recreate students_wider without pronouns
create view public.students_wider as
select
  id,
  first_name,
  last_name,
  preferred_name,
  full_name,
  personal_email,
  school_email,
  school_id,
  school_name_raw,
  year_group,
  postcode_district,
  subscribed_to_mailing,
  unsubscribed_at,
  notes,
  created_at,
  updated_at,
  created_by,
  updated_by,
  deleted_at
from public.students
where deleted_at is null;

grant select on public.students_wider to authenticated;
grant all on public.students_wider to anon;
grant all on public.students_wider to service_role;

commit;
