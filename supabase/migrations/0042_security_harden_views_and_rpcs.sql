-- ---------------------------------------------------------------------------
-- 0042_security_harden_views_and_rpcs.sql
--
-- Closes two RLS-bypass exposures found via the Supabase security advisor.
-- Applied via Supabase MCP at the same time this file landed in git.
--
-- 1. SECURITY DEFINER views (owned by postgres) were granted to anon AND
--    authenticated, so they bypassed RLS on students/applications. Anyone with
--    the public anon key — and any logged-in student via /my — could read all
--    student PII through them (students_enriched / students_wider /
--    applications_wider).
--
-- 2. Several SECURITY DEFINER functions were EXECUTE-able by anon (callable with
--    no login), some of which mutate data or are internal trigger/worker helpers.
-- ---------------------------------------------------------------------------

-- === Views =================================================================

-- students_enriched: read by the admin pages (as the `authenticated` role).
-- Switch it to respect the caller's RLS. Admins satisfy is_admin() on every
-- underlying table (students/applications/schools/events/application_rsvp) so
-- they still see ALL rows; logged-in non-admins see only their own row; anon
-- sees nothing. authenticated has SELECT on all base tables, so admin reads
-- won't error.
alter view public.students_enriched set (security_invoker = on);

-- Nothing writes through the view; strip write privileges and remove anon
-- entirely (this is admin-only data). Keep authenticated SELECT — RLS now
-- filters the rows.
revoke insert, update, delete, truncate, references, trigger on public.students_enriched from authenticated;
revoke all on public.students_enriched from anon;

-- students_wider / applications_wider: not referenced anywhere in the app.
-- Lock them down completely and make them invoker too in case grants are ever
-- re-added.
alter view public.students_wider     set (security_invoker = on);
alter view public.applications_wider set (security_invoker = on);
revoke all on public.students_wider     from anon, authenticated;
revoke all on public.applications_wider from anon, authenticated;

-- === Functions =============================================================

-- Trigger functions — invoked by triggers, never meant to be called as RPC.
revoke execute on function public.tg_audit_log() from anon, authenticated;
revoke execute on function public.sync_event_optout_from_application() from anon, authenticated;

-- Email-queue internals — only ever called by the worker with the service role
-- (process-email-queue uses SUPABASE_SERVICE_ROLE_KEY, which bypasses grants).
revoke execute on function public.claim_email_batch(integer)   from anon, authenticated;
revoke execute on function public.recover_stuck_email_sends()  from anon, authenticated;

-- Admin/internal operations — the app only calls these from signed-in sessions,
-- never anonymously. Remove anon's ability to call them. (Further restricting to
-- admins-only among authenticated users needs in-function is_admin() guards —
-- tracked as a follow-up, since admin == the generic `authenticated` role here.)
revoke execute on function public.promote_from_waitlist(uuid)                 from anon;
revoke execute on function public.link_students_by_raw(text, uuid)            from anon;
revoke execute on function public.dismiss_unlinked_raw(text)                  from anon;
revoke execute on function public.unlinked_school_review(integer)             from anon;
revoke execute on function public.unlinked_school_review(integer, integer, integer) from anon;
revoke execute on function public.get_latest_withdrawn_application(uuid)      from anon;
revoke execute on function public.withdraw_application(uuid)                  from anon;

-- search_schools stays callable by anon (public apply-form school autocomplete).
