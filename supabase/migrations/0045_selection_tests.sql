-- ---------------------------------------------------------------------------
-- 0045_selection_tests.sql
--
-- Timed online selection test (logic + arithmetic) used to differentiate
-- applicants at scale (first use: Step Inside: Man Group). Applied via
-- Supabase MCP at the same time this file landed in git.
--
-- Design notes:
--  * One test per event (unique index on event_id). 15-minute default.
--  * Question bank is larger than anyone can finish; score = number correct
--    (number-right scoring — no guessing penalty; the literature shows
--    negative marking penalises risk-averse candidates, esp. female /
--    high-ability, so UCAT/SAT/GRE all use rights-only). Accuracy and
--    questions-reached are stored as tiebreakers.
--  * Students have NO direct (RLS) access to ANY of these tables. All
--    student interaction goes through service-role API routes
--    (/api/test/*), so correct answers and other students' results can
--    never reach a browser. Admin client reads via is_admin() policies.
--  * Server-authoritative timing: deadline_at is set at start; the API
--    refuses answers after it (small grace) and finalises overdue attempts.
--  * One attempt per student per test (partial unique index excludes
--    'voided' so an admin can void an attempt to allow a genuine-tech-
--    failure retake; there is NO student-side reset).
--  * Team practice mode: kind='team' attempts keyed by team_email, never
--    linked to students/applications.
-- ---------------------------------------------------------------------------

create table public.tests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null default 'Selection Test',
  status text not null default 'draft' check (status in ('draft','open','closed')),
  duration_seconds integer not null default 900 check (duration_seconds between 60 and 7200),
  opens_at timestamptz,
  closes_at timestamptz,
  video_url text,
  instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.tests is 'Timed selection tests, one per event. status=draft|open|closed; opens_at/closes_at further bound the open window when set.';
create unique index tests_event_id_key on public.tests(event_id);

create table public.test_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  position integer not null default 0,
  difficulty smallint not null default 2 check (difficulty in (1,2,3)),
  category text not null check (category in ('arithmetic','numerical','sequence','logic','verbal')),
  prompt text not null,
  options jsonb not null,
  correct_index smallint not null check (correct_index >= 0),
  explanation text,
  is_practice boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint test_questions_options_array check (jsonb_typeof(options) = 'array')
);
comment on table public.test_questions is 'MCQ bank. correct_index/explanation must NEVER be exposed to students for live (non-practice) questions — student reads go through /api/test/* which strips them.';
create index test_questions_test_id_idx on public.test_questions(test_id);

create table public.test_invitations (
  test_id uuid not null references public.tests(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  invited_by uuid,
  invited_at timestamptz not null default now(),
  primary key (test_id, student_id)
);
comment on table public.test_invitations is 'Explicit invite list: only invited students can start the test.';

create table public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  kind text not null default 'student' check (kind in ('student','team')),
  student_id uuid references public.students(id) on delete cascade,
  team_email text,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  submitted_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress','submitted','expired','voided')),
  question_order uuid[] not null,
  current_index integer not null default 0,
  answered_count integer not null default 0,
  correct_count integer,
  score numeric,
  voided_by uuid,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint test_attempts_subject check (
    (kind = 'student' and student_id is not null and team_email is null)
    or (kind = 'team' and team_email is not null and student_id is null)
  )
);
comment on table public.test_attempts is 'One live attempt per student per test (voided attempts excluded so admins can grant a retake). score = correct_count (number-right).';
create unique index test_attempts_one_live_per_student
  on public.test_attempts(test_id, student_id)
  where kind = 'student' and status <> 'voided';
create index test_attempts_test_id_idx on public.test_attempts(test_id);
create index test_attempts_student_id_idx on public.test_attempts(student_id);

create table public.test_answers (
  attempt_id uuid not null references public.test_attempts(id) on delete cascade,
  question_id uuid not null references public.test_questions(id) on delete cascade,
  selected_index smallint,
  is_correct boolean,
  answered_at timestamptz not null default now(),
  time_ms integer,
  primary key (attempt_id, question_id)
);
comment on table public.test_answers is 'Per-question responses. time_ms = server-measured ms between question serve and answer.';

-- ---------------------------------------------------------------------------
-- RLS: deny-by-default for anon + students. Admins (is_admin()) get full
-- access from the admin client. Students/team-practice go through
-- service-role API routes which bypass RLS deliberately.
-- ---------------------------------------------------------------------------
alter table public.tests enable row level security;
alter table public.test_questions enable row level security;
alter table public.test_invitations enable row level security;
alter table public.test_attempts enable row level security;
alter table public.test_answers enable row level security;

create policy tests_admin_all on public.tests
  for all to authenticated
  using (coalesce(public.is_admin(), false))
  with check (coalesce(public.is_admin(), false));

create policy test_questions_admin_all on public.test_questions
  for all to authenticated
  using (coalesce(public.is_admin(), false))
  with check (coalesce(public.is_admin(), false));

create policy test_invitations_admin_all on public.test_invitations
  for all to authenticated
  using (coalesce(public.is_admin(), false))
  with check (coalesce(public.is_admin(), false));

create policy test_attempts_admin_all on public.test_attempts
  for all to authenticated
  using (coalesce(public.is_admin(), false))
  with check (coalesce(public.is_admin(), false));

create policy test_answers_admin_all on public.test_answers
  for all to authenticated
  using (coalesce(public.is_admin(), false))
  with check (coalesce(public.is_admin(), false));
