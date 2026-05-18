-- =============================================================================
-- Steps Intranet — Per-event email opt-outs
-- Date: 2026-05-18
--
-- Students can opt out of receiving any further emails about a specific event
-- (invites, reminders, decisions, check-in nudges) without unsubscribing from
-- the general mailing list. Use case: a student gets an invite to an event
-- they have no interest in and wants to stop the follow-ups without nuking
-- all future Steps emails.
--
-- Scope: this table is consulted by the email queue worker as a hard skip
-- before any send for (student, event). Mirrors the existing unsubscribe
-- guard in process-email-queue.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.event_email_optouts (
  student_id     uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  event_id       uuid NOT NULL REFERENCES public.events(id)   ON DELETE CASCADE,
  opted_out_at   timestamptz NOT NULL DEFAULT NOW(),
  source         text NOT NULL DEFAULT 'email_link',
  PRIMARY KEY (student_id, event_id)
);

COMMENT ON TABLE public.event_email_optouts IS
  'Per-event email opt-outs. A row here means "do not send this student any further emails about this event". Distinct from students.subscribed_to_mailing which is the global newsletter opt-out.';

CREATE INDEX IF NOT EXISTS event_email_optouts_event_idx
  ON public.event_email_optouts (event_id);

ALTER TABLE public.event_email_optouts ENABLE ROW LEVEL SECURITY;

-- Admin full access (consistent with other admin-managed tables).
DROP POLICY IF EXISTS event_email_optouts_admin_all ON public.event_email_optouts;
CREATE POLICY event_email_optouts_admin_all ON public.event_email_optouts
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Students can read their OWN opt-out rows (so a logged-in student could see
-- which events they've opted out of, if we surface this in /my later).
DROP POLICY IF EXISTS event_email_optouts_self_select ON public.event_email_optouts;
CREATE POLICY event_email_optouts_self_select ON public.event_email_optouts
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT id FROM public.students
      WHERE personal_email = lower(auth.jwt() ->> 'email')
    )
  );

-- No INSERT/UPDATE/DELETE policy for `authenticated` students — opt-outs are
-- written exclusively by the /api/event-optout route using the service role
-- key (the link is HMAC-signed and the recipient isn't necessarily logged in
-- when they click it).
