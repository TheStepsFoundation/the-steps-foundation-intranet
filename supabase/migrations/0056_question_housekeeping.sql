-- 0056: question housekeeping (applied directly via MCP, this file matches live DB)
--
-- 1) Verbal #19 had mismatched analogy relations (Favour's catch): "Book is to
--    Reading" pairs an OBJECT with its activity, while "Fork is to Eating"
--    pairs an INSTRUMENT with its activity - you read a book, but you don't
--    eat a fork. Rewritten as Pen : Writing :: Fork : Eating so both sides are
--    instrument -> activity. Options and answer unchanged ("Drawing" now also
--    catches anyone pairing with the pen instead of the fork).
--
-- 2) NVR dedupe: the 0055 staged apply deactivated all nonverbal rows before
--    re-inserting; three of them were referenced by preview-attempt answers,
--    so the delete skipped them - leaving inactive rows whose content is
--    identical to an active twin. Repoint those answers at the twin (same
--    prompt/options/answer), then delete the now-unreferenced inactive copy.

update public.test_questions
set prompt = 'Pen is to Writing as Fork is to …?',
    explanation = 'A pen is the instrument you write with, and a fork is the instrument you eat with — the same relation on both sides. Cutlery is what a fork is, not what it is used for.'
where prompt = 'Book is to Reading as Fork is to …?';

with t as (select id from public.tests where event_id = 'b5e7f8a1-3c9d-4b2e-8f1a-6d7c8e9f0a1b' limit 1),
dups as (
  select q.id as old_id,
         (select a.id from public.test_questions a
          where a.test_id = q.test_id and a.active and a.category = 'nonverbal'
            and a.prompt = q.prompt and a.options = q.options
            and a.correct_index = q.correct_index and a.is_practice = q.is_practice
          limit 1) as twin_id
  from public.test_questions q, t
  where q.test_id = t.id and q.category = 'nonverbal' and not q.active
)
update public.test_answers ans set question_id = d.twin_id
from dups d
where ans.question_id = d.old_id and d.twin_id is not null;

with t as (select id from public.tests where event_id = 'b5e7f8a1-3c9d-4b2e-8f1a-6d7c8e9f0a1b' limit 1)
delete from public.test_questions q
where q.test_id = (select id from t) and q.category = 'nonverbal' and not q.active
  and exists (select 1 from public.test_questions a
              where a.test_id = q.test_id and a.active and a.category = 'nonverbal'
                and a.prompt = q.prompt and a.options = q.options
                and a.correct_index = q.correct_index and a.is_practice = q.is_practice);
