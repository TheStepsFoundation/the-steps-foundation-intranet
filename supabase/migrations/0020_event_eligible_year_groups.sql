-- Per-event year-group gate. NULL = open to all year groups; array = only
-- those year groups (integer 9..13, matching students.year_group).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS eligible_year_groups integer[] DEFAULT NULL;

COMMENT ON COLUMN public.events.eligible_year_groups IS
  'List of eligible student year groups (9-13). NULL means open to all year groups.';

-- Guard: if set, must be non-empty and values within 9..13.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_eligible_year_groups_range_chk'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_eligible_year_groups_range_chk
      CHECK (
        eligible_year_groups IS NULL
        OR (
          array_length(eligible_year_groups, 1) > 0
          AND eligible_year_groups <@ ARRAY[9,10,11,12,13]::integer[]
        )
      );
  END IF;
END $$;

-- Seed: Step Inside: Man Group is Y13-only.
UPDATE public.events
SET eligible_year_groups = ARRAY[13]::integer[]
WHERE slug = 'man-group-office-visit' AND eligible_year_groups IS NULL;
