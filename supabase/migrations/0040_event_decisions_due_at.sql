-- ---------------------------------------------------------------------------
-- 0040_event_decisions_due_at.sql
--
-- Internal deadline for making accept/reject decisions on an event's submitted
-- applications. Distinct from applications_close_at (when the public apply form
-- closes) — decisions are due LATER than the close date. Applied via Supabase
-- MCP at the same time this file landed in git, so dev/prod stay in sync.
--
-- When NULL, the app defaults to 1.5 weeks (10.5 days) before event_date; this
-- column lets admins override that default per event. Additive + nullable, no
-- backfill (the NULL default keeps tracking event_date until overridden).
-- ---------------------------------------------------------------------------

alter table public.events add column if not exists decisions_due_at timestamptz;

comment on column public.events.decisions_due_at is
  'Internal accept/reject decision deadline. NULL => app default of event_date minus 10.5 days (1.5 weeks). Editable per event.';
