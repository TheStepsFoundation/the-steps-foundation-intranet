-- =============================================================================
-- Steps Intranet — Keep event_email_optouts in sync with application status
-- Date: 2026-05-18
--
-- Invariant Favour asked for:
--   • Applying to an event ⇒ implicitly opt INTO comms about that event.
--     Any standing event opt-out for (student, event) gets cleared.
--   • Withdrawing an application ⇒ implicitly opt OUT of further comms.
--     A row is inserted (or refreshed) in event_email_optouts.
--
-- Enforce in a single trigger on the applications table so every path that
-- mutates status — the apply form, /api/withdraw, the hub withdraw button,
-- admin status changes via the events page, the withdraw_application RPC —
-- all behave the same way. No client coordination needed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_event_optout_from_application()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Withdrawals: register an opt-out (idempotent). source='auto_from_withdraw'
  -- distinguishes from email-link / hub / admin opt-outs in any future audit.
  IF NEW.status = 'withdrew' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.event_email_optouts (student_id, event_id, source)
    VALUES (NEW.student_id, NEW.event_id, 'auto_from_withdraw')
    ON CONFLICT (student_id, event_id) DO UPDATE
      SET opted_out_at = NOW(),
          source = 'auto_from_withdraw';
  END IF;

  -- Live applications: clear any standing opt-out. Idempotent — harmless if
  -- no row exists. Covers re-apply after withdraw, fresh first submission,
  -- and status promotions like submitted → accepted.
  IF NEW.status <> 'withdrew' THEN
    DELETE FROM public.event_email_optouts
    WHERE student_id = NEW.student_id
      AND event_id = NEW.event_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_event_optout_from_application_trg ON public.applications;
CREATE TRIGGER sync_event_optout_from_application_trg
AFTER INSERT OR UPDATE OF status ON public.applications
FOR EACH ROW
EXECUTE FUNCTION public.sync_event_optout_from_application();

COMMENT ON FUNCTION public.sync_event_optout_from_application() IS
  'Trigger: keeps event_email_optouts in lockstep with applications.status. Withdraw → opt-out (idempotent). Any live status → clear opt-out.';
