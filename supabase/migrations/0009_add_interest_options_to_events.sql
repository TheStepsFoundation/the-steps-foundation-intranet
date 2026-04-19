-- Steps Intranet — Add interest_options to events
-- Stores per-event interest/preference options shown on the application form.
-- Applicants rank their top 3 choices.
-- Format: [{value: string, label: string}, ...]

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS interest_options jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.events.interest_options IS
  'Per-event interest options shown on the application form. Array of {value, label} objects. Applicants rank their top 3.';
