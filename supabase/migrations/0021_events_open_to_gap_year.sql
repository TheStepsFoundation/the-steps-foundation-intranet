-- Per-event gap-year gate. Independent of eligible_year_groups (which covers
-- Y9-Y13). Defaults to false; set to true to open an event to gap-year students
-- in addition to any selected year groups.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS open_to_gap_year boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.open_to_gap_year IS
  'If true, gap-year students are also eligible (in addition to any eligible_year_groups).';
