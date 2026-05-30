-- ---------------------------------------------------------------------------
-- 0038_team_member_avatar_url.sql
--
-- Optional uploaded profile photo for team members. Applied via Supabase MCP
-- at the same time this file landed in git, so dev/prod stay in sync.
--
-- `avatar` (existing) stays as the 2-letter initials used by the Task Tracker.
-- `avatar_url` (new) holds a public URL when a member uploads a photo; NULL
-- means "no photo — fall back to initials". Additive + nullable, no backfill.
-- ---------------------------------------------------------------------------

alter table public.team_members add column if not exists avatar_url text;
