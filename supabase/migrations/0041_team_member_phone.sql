-- ---------------------------------------------------------------------------
-- 0041_team_member_phone.sql
--
-- Optional contact phone number for a team member, surfaced + edited on the
-- personal /profile page. Applied via Supabase MCP at the same time this file
-- landed in git, so dev/prod stay in sync.
--
-- Additive + nullable, no backfill. Non-admin ('wider') members are RLS-blocked
-- from client-side team_members writes (team_members_admin_all only allows
-- writes when is_admin()), so the phone is saved through the service-role route
-- /api/profile/update-phone, scoped strictly to the caller's own row.
-- ---------------------------------------------------------------------------

alter table public.team_members add column if not exists phone text;

comment on column public.team_members.phone is
  'Optional contact phone for a team member. Self-editable via /api/profile/update-phone (service-role route scoped to the caller''s own row) because non-admin (wider) members are RLS-blocked from client-side team_members writes.';
