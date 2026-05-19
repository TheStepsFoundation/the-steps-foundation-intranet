-- =============================================================================
-- Steps Intranet — Student self-service writes on event_email_optouts
-- Date: 2026-05-18
--
-- Adds INSERT + DELETE policies so an authenticated student can manage their
-- own per-event opt-outs from /my (Email preferences card). Admin all + self
-- select policies stay; the /api/event-optout route continues to write via
-- the service role for email-link clicks (recipient may not have a session).
-- =============================================================================

DROP POLICY IF EXISTS event_email_optouts_self_insert ON public.event_email_optouts;
CREATE POLICY event_email_optouts_self_insert ON public.event_email_optouts
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id IN (
      SELECT id FROM public.students
      WHERE personal_email = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS event_email_optouts_self_delete ON public.event_email_optouts;
CREATE POLICY event_email_optouts_self_delete ON public.event_email_optouts
  FOR DELETE TO authenticated
  USING (
    student_id IN (
      SELECT id FROM public.students
      WHERE personal_email = lower(auth.jwt() ->> 'email')
    )
  );
