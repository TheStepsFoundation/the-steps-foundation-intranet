-- =============================================================================
-- Steps Intranet — Per-event display initials override
-- Date: 2026-05-18
--
-- Two events with the same first letters (e.g. "Step Inside: Man Group" and
-- "Step Inside: Microsoft" both auto-derive "SIM") need a way to disambiguate
-- in shorthand UIs. Add an optional text override; the auto-derive in
-- events-cache.shortFor falls back to it when set.
-- =============================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS display_initials text;

COMMENT ON COLUMN public.events.display_initials IS
  'Optional short tag (2-4 chars) used as the event''s display initials in shorthand UIs (column headers, badges). When NULL, falls back to auto-derived from name.';
