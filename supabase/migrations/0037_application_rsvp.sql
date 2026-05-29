-- ---------------------------------------------------------------------------
-- 0037_application_rsvp.sql
--
-- RSVP tracking for accepted applications. Applied via Supabase MCP at the
-- same time this file landed in git, so dev/prod stay in sync.
--
-- Lifecycle:
--   rsvp = NULL          : not yet accepted, or accepted pre-feature
--   rsvp = 'pending'     : accepted, no answer yet (auto-set by trigger)
--   rsvp = 'yes'         : confirmed attending
--   rsvp = 'maybe'       : "Not sure" — undecided, follow up later
--   rsvp = 'no'          : "Can't make it" — application stays accepted,
--                          seat is freed for a waitlister
-- ---------------------------------------------------------------------------

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS rsvp TEXT
    CHECK (rsvp IN ('pending', 'yes', 'maybe', 'no'))
    DEFAULT NULL;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS rsvp_updated_at TIMESTAMPTZ NULL;

CREATE OR REPLACE FUNCTION public.set_rsvp_pending_on_accept()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'accepted'
     AND (OLD.status IS DISTINCT FROM 'accepted')
     AND NEW.rsvp IS NULL THEN
    NEW.rsvp := 'pending';
    NEW.rsvp_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_rsvp_pending_on_accept ON applications;
CREATE TRIGGER trg_set_rsvp_pending_on_accept
  BEFORE UPDATE OF status ON applications
  FOR EACH ROW
  EXECUTE FUNCTION public.set_rsvp_pending_on_accept();

CREATE OR REPLACE FUNCTION public.stamp_rsvp_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.rsvp IS DISTINCT FROM OLD.rsvp THEN
    NEW.rsvp_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_rsvp_updated_at ON applications;
CREATE TRIGGER trg_stamp_rsvp_updated_at
  BEFORE UPDATE OF rsvp ON applications
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_rsvp_updated_at();

CREATE INDEX IF NOT EXISTS idx_applications_event_waitlist_created
  ON applications(event_id, created_at)
  WHERE status = 'waitlist' AND deleted_at IS NULL;
