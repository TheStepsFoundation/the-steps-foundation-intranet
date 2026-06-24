-- ---------------------------------------------------------------------------
-- 0064_auto_expire_overdue_test_attempts.sql
--
-- Finalise (score + close) any selection-test attempt left 'in_progress' past
-- its deadline. The app finalises LAZILY — only when the next /api/test/*
-- request touches an attempt (see expireIfOverdue/finalizeAttempt in
-- src/lib/test-server.ts). So an abandoned attempt (student closed the tab or
-- lost connection before submitting) could sit 'in_progress' indefinitely even
-- though its server-side timed window had long closed, showing a stuck "in
-- progress" with no score in the admin results.
--
-- This adds a safety-net sweep, scheduled via pg_cron (same mechanism as the
-- retention jobs), so the score a student gets is locked in the moment the
-- timer runs out and an attempt is never left hanging. The logic mirrors
-- finalizeAttempt() exactly: status -> 'expired', submitted_at = now(),
-- score = number of correct answers, incl. the 3s answer grace (ANSWER_GRACE_MS).
--
-- Applied via Supabase MCP at the same time this file landed in git.
-- ---------------------------------------------------------------------------

create or replace function public.finalize_overdue_test_attempts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare n integer;
begin
  with overdue as (
    select id
    from public.test_attempts
    where status = 'in_progress'
      and now() > deadline_at + interval '3 seconds'
    for update skip locked
  )
  update public.test_attempts a
  set status         = 'expired',
      submitted_at   = now(),
      answered_count = (select count(*) from public.test_answers ta where ta.attempt_id = a.id and ta.selected_index is not null),
      correct_count  = (select count(*) from public.test_answers ta where ta.attempt_id = a.id and ta.is_correct),
      score          = (select count(*) from public.test_answers ta where ta.attempt_id = a.id and ta.is_correct)
  from overdue
  where a.id = overdue.id
    and a.status = 'in_progress';
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- System/admin function only — never reachable by students (matches the
-- 0043/0044 definer-lockdown convention).
revoke execute on function public.finalize_overdue_test_attempts() from public, anon, authenticated;

-- Run every minute (same cadence as process-email-queue). cron.schedule
-- upserts by job name, so re-applying this migration is idempotent.
select cron.schedule(
  'finalize-overdue-test-attempts',
  '* * * * *',
  $job$select public.finalize_overdue_test_attempts();$job$
);
