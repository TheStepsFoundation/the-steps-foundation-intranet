-- 0048: AI applicant review
--
-- applications.ai_review — output of the AI reviewer (score, summary, flags,
-- suggested internal decision). Admin-only: student reads go through the
-- explicit column lists in hub-api.ts, same protection model as
-- internal_review_status. Never surfaced to students.
--
-- events.review_rubric — admin-editable rubric text the model scores against.
-- NULL means the built-in default rubric is used.

alter table public.applications add column if not exists ai_review jsonb;
alter table public.events add column if not exists review_rubric text;

comment on column public.applications.ai_review is
  'AI reviewer output: { score 1-5, summary, reason, flags[], suggested_internal, model, created_at }. Admin-only - never exposed to students.';
comment on column public.events.review_rubric is
  'Admin-written rubric used by the AI applicant reviewer (null = default rubric).';
