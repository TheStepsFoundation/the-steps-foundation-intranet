-- Tag email_outbox rows as marketing vs transactional so the worker can
-- apply the marketing-only rolling-24h cap and unsubscribe skip.
--
-- transactional: event decisions, OTP, 1:1 replies — always send.
-- marketing   : invite batches queued via InviteStudentsModal — subject
--               to the 1,700/24h cap enforced in lib/send-cap.ts.

ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'transactional';

-- Only add the constraint if it isn't already there (safe to re-run).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_outbox_kind_check'
  ) THEN
    ALTER TABLE public.email_outbox
      ADD CONSTRAINT email_outbox_kind_check
      CHECK (kind IN ('transactional', 'marketing'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS email_outbox_kind_status_idx
  ON public.email_outbox (kind, status);
