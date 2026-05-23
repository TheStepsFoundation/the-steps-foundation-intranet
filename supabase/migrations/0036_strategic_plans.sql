-- =============================================================================
-- Steps Intranet — Task Tracker: Long-Term Strategic Plans
-- Date: 2026-05-23
-- Author: Favour (with Claude)
--
-- Adds the "Strategy" section to the Task Tracker module:
--   1. strategic_pillars  — lookup of strategic themes (Growth, Partnerships…)
--   2. strategic_plans    — long-term plans (owner, pillar, horizon, RAG, %)
--   3. strategic_milestones — checklist of milestones under each plan
--   4. updated_at + audit triggers
--   5. RLS: admin full CRUD; admin+wider read
--
-- Linkage model: a plan optionally references an existing tracker workflow
-- (workflow_id) so related tactical tasks surface without coupling to
-- individual task rows. owner_id references team_members(id) (int) to stay
-- consistent with the rest of the task tracker (tasks.assignee is int).
--
-- Depends on: original task-tracker schema (team_members, workflows),
--             0002 (RLS helpers: is_admin(), is_wider_or_admin()),
--             0007 (trigger fns tg_set_updated_at(), tg_audit_log()).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. strategic_pillars — lookup (enum-as-table so new themes need no migration)
-- -----------------------------------------------------------------------------
create table if not exists public.strategic_pillars (
  code        text primary key,
  label       text not null,
  color       text not null default 'bg-steps-blue-500',
  sort_order  int  not null default 0
);

insert into public.strategic_pillars (code, label, color, sort_order) values
  ('growth',       'Growth',              'bg-steps-blue-500', 10),
  ('partnerships', 'Partnerships',        'bg-amber-500',      20),
  ('programmes',   'Programmes',          'bg-green-500',      30),
  ('fundraising',  'Fundraising',         'bg-rose-500',       40),
  ('team_ops',     'Team & Operations',   'bg-violet-500',     50)
on conflict (code) do nothing;

comment on table public.strategic_pillars is
  'Strategic themes used to categorise long-term plans. Add rows freely — no migration needed.';

-- -----------------------------------------------------------------------------
-- 2. strategic_plans — one row per long-term strategic plan
-- -----------------------------------------------------------------------------
create table if not exists public.strategic_plans (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text not null default '',
  owner_id      int  references public.team_members(id) on delete set null,
  pillar        text references public.strategic_pillars(code) on delete set null,
  horizon       text check (horizon in ('1_year', '3_year', '5_year', 'ongoing')),
  start_date    date,
  target_date   date,
  status        text not null default 'not_started'
                  check (status in ('not_started', 'on_track', 'at_risk', 'off_track', 'achieved')),
  progress      int  not null default 0 check (progress between 0 and 100),
  workflow_id   text references public.workflows(id) on delete set null,
  sort_order    int  not null default 0,
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    text
);

create index if not exists strategic_plans_pillar_idx   on public.strategic_plans (pillar);
create index if not exists strategic_plans_status_idx   on public.strategic_plans (status);
create index if not exists strategic_plans_owner_idx    on public.strategic_plans (owner_id);
create index if not exists strategic_plans_workflow_idx on public.strategic_plans (workflow_id);

comment on table public.strategic_plans is
  'Long-term strategic plans for the Task Tracker. owner_id -> team_members(id) (int). workflow_id optionally links a plan to a tracker workflow so related tasks surface.';

-- -----------------------------------------------------------------------------
-- 3. strategic_milestones — checklist of milestones under a plan
-- -----------------------------------------------------------------------------
create table if not exists public.strategic_milestones (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.strategic_plans(id) on delete cascade,
  title         text not null,
  due_date      date,
  completed     boolean not null default false,
  completed_at  timestamptz,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists strategic_milestones_plan_idx on public.strategic_milestones (plan_id);

comment on table public.strategic_milestones is
  'Milestones / checkpoints under a strategic plan. Cascade-deleted with the plan.';

-- -----------------------------------------------------------------------------
-- 4. Triggers — updated_at + audit-log (reuse existing trigger functions)
-- -----------------------------------------------------------------------------
drop trigger if exists set_updated_at on public.strategic_plans;
create trigger set_updated_at before update on public.strategic_plans
  for each row execute function public.tg_set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['strategic_pillars', 'strategic_plans', 'strategic_milestones']
  loop
    execute format(
      'drop trigger if exists audit_log_trigger on public.%I;
       create trigger audit_log_trigger
         after insert or update or delete on public.%I
         for each row execute function public.tg_audit_log();',
      t, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 5. RLS — admin full CRUD; admin + wider read. Mirrors intranet table policy.
-- -----------------------------------------------------------------------------
alter table public.strategic_pillars    enable row level security;
alter table public.strategic_plans      enable row level security;
alter table public.strategic_milestones enable row level security;

-- strategic_pillars
drop policy if exists strategic_pillars_admin_all on public.strategic_pillars;
create policy strategic_pillars_admin_all on public.strategic_pillars
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists strategic_pillars_read on public.strategic_pillars;
create policy strategic_pillars_read on public.strategic_pillars
  for select to authenticated
  using (public.is_wider_or_admin());

-- strategic_plans
drop policy if exists strategic_plans_admin_all on public.strategic_plans;
create policy strategic_plans_admin_all on public.strategic_plans
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists strategic_plans_read on public.strategic_plans;
create policy strategic_plans_read on public.strategic_plans
  for select to authenticated
  using (public.is_wider_or_admin());

-- strategic_milestones
drop policy if exists strategic_milestones_admin_all on public.strategic_milestones;
create policy strategic_milestones_admin_all on public.strategic_milestones
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists strategic_milestones_read on public.strategic_milestones;
create policy strategic_milestones_read on public.strategic_milestones
  for select to authenticated
  using (public.is_wider_or_admin());

-- Grants (RLS still applies on top)
grant select, insert, update, delete on public.strategic_pillars to authenticated;
grant select, insert, update, delete on public.strategic_plans to authenticated;
grant select, insert, update, delete on public.strategic_milestones to authenticated;
