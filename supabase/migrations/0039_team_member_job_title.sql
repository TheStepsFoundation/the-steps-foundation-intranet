-- ---------------------------------------------------------------------------
-- 0039_team_member_job_title.sql
--
-- Optional human-readable job title shown under a team member's profile photo
-- (e.g. "Co-Founder", "Core Team"). Backend-assigned only — there is no in-app
-- editor; set it via SQL / the Supabase dashboard. Applied via Supabase MCP at
-- the same time this file landed in git, so dev/prod stay in sync.
-- ---------------------------------------------------------------------------

alter table public.team_members add column if not exists job_title text;

update public.team_members set job_title = 'Co-Founder' where id in (1,2,3,8,9,10);
update public.team_members set job_title = 'Core Team' where id in (4,6,11,13);
