-- =============================================================================
-- Steps Intranet — Private (invite-only) events
-- Date: 2026-05-18
--
-- A private event is invisible on /my for any authenticated student who hasn't
-- been invited via the InviteStudentsModal. The apply form at /apply/[slug]
-- remains reachable for anyone who has the link (it's served by the existing
-- anon read policy) — invites always carry the slug, and the slug isn't
-- discoverable from the hub for non-invitees, so this is the right surface for
-- the privacy boundary.
--
-- New table event_invitations is the source of truth for "this student has
-- been invited to this event". Populated by the modal's send loop on each
-- successful send.
-- =============================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.is_private IS
  'When true, the event only shows on the student hub for students with a row in event_invitations. Public eligibility rules are bypassed for the visibility check (private trumps eligibility).';

CREATE TABLE IF NOT EXISTS public.event_invitations (
  student_id   uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  event_id     uuid NOT NULL REFERENCES public.events(id)   ON DELETE CASCADE,
  invited_at   timestamptz NOT NULL DEFAULT NOW(),
  invited_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (student_id, event_id)
);

COMMENT ON TABLE public.event_invitations IS
  'Source of truth for "this student has been invited to this event via the InviteStudentsModal". Drives visibility of private events on the student hub.';

CREATE INDEX IF NOT EXISTS event_invitations_event_idx
  ON public.event_invitations (event_id);

ALTER TABLE public.event_invitations ENABLE ROW LEVEL SECURITY;

-- Admin full access.
DROP POLICY IF EXISTS event_invitations_admin_all ON public.event_invitations;
CREATE POLICY event_invitations_admin_all ON public.event_invitations
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Students can read their own invitations (so the RLS subquery on events
-- can resolve via security definer? actually we use the policy on events
-- directly; this is just so a student could query their own invites if
-- we ever surface them in /my).
DROP POLICY IF EXISTS event_invitations_self_select ON public.event_invitations;
CREATE POLICY event_invitations_self_select ON public.event_invitations
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT id FROM public.students
      WHERE personal_email = lower(auth.jwt() ->> 'email')
    )
  );

-- ----------------------------------------------------------------------------
-- Update the authenticated events_read policy to gate private events.
-- The anon events_public_read policy stays permissive so /apply/[slug] still
-- works for invitees who click through from the invite email.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS events_read ON public.events;
CREATE POLICY events_read ON public.events
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      deleted_at IS NULL
      AND (
        is_private = false
        OR EXISTS (
          SELECT 1
          FROM public.event_invitations ei
          JOIN public.students s ON s.id = ei.student_id
          WHERE ei.event_id = events.id
            AND s.personal_email = lower(auth.jwt() ->> 'email')
        )
      )
    )
  );
