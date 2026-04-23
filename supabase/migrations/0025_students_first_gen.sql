-- 0025_students_first_gen.sql
--
-- Add first_generation_uni as a first-class student profile field. The stage-1
-- apply form will ask "Did you grow up in a household where at least one parent
-- went to university?" — UI polarity is flipped but the DB semantic stays
-- intuitive: first_generation_uni=true means the student IS first-gen.
--
-- Backfill from the most recent non-deleted application per student, preferring
-- the clean `first_gen` key (298 rows) over the older `first_generation_uni`
-- key (174 rows, often null).

begin;

alter table public.students
  add column if not exists first_generation_uni boolean;

with latest as (
  select distinct on (student_id)
    student_id,
    raw_response ->> 'first_gen'             as first_gen_v1,
    raw_response ->> 'first_generation_uni'  as first_gen_v2
  from public.applications
  where deleted_at is null
  order by student_id, submitted_at desc nulls last
)
update public.students s set
  first_generation_uni = coalesce(
    s.first_generation_uni,
    -- v1: 'true'/'false' strings
    case latest.first_gen_v1 when 'true' then true when 'false' then false else null end,
    -- v2: usually 'true' or null, but handle 'false' defensively
    case latest.first_gen_v2 when 'true' then true when 'false' then false else null end
  ),
  updated_at = now()
from latest
where latest.student_id = s.id
  and (latest.first_gen_v1 is not null or latest.first_gen_v2 is not null);

commit;
