-- ---------------------------------------------------------------------------
-- 0043_lock_definer_functions_from_public.sql
--
-- Correction to 0042. Postgres grants EXECUTE on functions to PUBLIC by
-- default, so "REVOKE EXECUTE ... FROM anon" in 0042 was a no-op while the
-- PUBLIC grant remained — anon could still call these SECURITY DEFINER RPCs.
-- This revokes from PUBLIC (the real lock) and re-grants explicitly to the
-- roles that legitimately need each function, so app behaviour is unchanged.
--
-- service_role = the server-side key (process-email-queue, withdraw API, etc.),
-- which must keep access. authenticated = signed-in sessions (admin pages).
-- anon (logged-out) loses access to all of these. search_schools is left alone
-- (the public apply form needs it for school autocomplete).
-- ---------------------------------------------------------------------------

-- Internal / worker / trigger functions: server-side (service_role) or trigger
-- context only. No anon, no authenticated.
revoke execute on function public.claim_email_batch(integer)            from public, anon, authenticated;
grant  execute on function public.claim_email_batch(integer)            to service_role;

revoke execute on function public.recover_stuck_email_sends()           from public, anon, authenticated;
grant  execute on function public.recover_stuck_email_sends()           to service_role;

revoke execute on function public.tg_audit_log()                        from public, anon, authenticated;
grant  execute on function public.tg_audit_log()                        to service_role;

revoke execute on function public.sync_event_optout_from_application()  from public, anon, authenticated;
grant  execute on function public.sync_event_optout_from_application()  to service_role;

-- Admin / app operations: signed-in sessions + server routes, never anon.
-- (Restricting these to admins-only among authenticated users still needs an
-- in-function is_admin() guard — tracked as a follow-up.)
revoke execute on function public.promote_from_waitlist(uuid)               from public, anon;
grant  execute on function public.promote_from_waitlist(uuid)               to authenticated, service_role;

revoke execute on function public.withdraw_application(uuid)                 from public, anon;
grant  execute on function public.withdraw_application(uuid)                 to authenticated, service_role;

revoke execute on function public.get_latest_withdrawn_application(uuid)     from public, anon;
grant  execute on function public.get_latest_withdrawn_application(uuid)     to authenticated, service_role;

revoke execute on function public.link_students_by_raw(text, uuid)          from public, anon;
grant  execute on function public.link_students_by_raw(text, uuid)          to authenticated, service_role;

revoke execute on function public.dismiss_unlinked_raw(text)                from public, anon;
grant  execute on function public.dismiss_unlinked_raw(text)                to authenticated, service_role;

revoke execute on function public.unlinked_school_review(integer)                          from public, anon;
grant  execute on function public.unlinked_school_review(integer)                          to authenticated, service_role;

revoke execute on function public.unlinked_school_review(integer, integer, integer)        from public, anon;
grant  execute on function public.unlinked_school_review(integer, integer, integer)        to authenticated, service_role;
