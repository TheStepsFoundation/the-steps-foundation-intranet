# CLAUDE.md — Steps Foundation Intranet

This repo is the **Steps Foundation Intranet**. It started as the Steps Task Tracker and has been broadened in scope: the task tracker is now one module alongside a new student database, events, campaigns, and admin modules.

Repo: `github.com/TheStepsFoundation/the-steps-foundation-intranet`.

## Modules

- **Task Tracker** *(existing)* — 7 views (Board, Team, List, Workload, Calendar, Gantt, Today's Focus), Discord integration, workflow templates. Largely lives in `src/app/page.tsx`.
- **Student Database** *(new, Phase 1)* — student records, cohort tracking, event attendance.
- **Events** *(planned)* — event lifecycle management (Starting Point, Oxbridge, Degree Apprenticeship, Great Lock-In, Westminster).
- **Campaigns** *(planned)* — outreach and partnership tracking (Man Group, Westminster, Bexley Grammar).
- **Admin** *(planned)* — team/permissions/settings.

## Design doc

Phase 1 scope and module contracts: **`Steps Intranet - Phase 1 Design Doc.md`** in the TSF Google Workspace folder (`hello@thestepsfoundation.com`). Read this before starting any Phase 1 work.

## Stack

Next.js 14 + React 18 + TypeScript, Tailwind (dark mode via class), Supabase (Postgres + Auth, Google OAuth implicit flow), Vercel auto-deploy on push to `master`. No API routes — client-side Supabase SDK only.

- Supabase project: `rvspshqltnyormiqaidx.supabase.co`
- RLS enabled on all tables with public policies; app enforces permissioning.

## Conventions (carry over from task tracker)

- Dragging a task to a new assignee makes the old assignee a **collaborator**, not removed.
- Archive ≠ done. Archived items keep their status and reappear on unarchive.
- `createdBy` tracks authorship where present.
- Workload defaults: 10h/person/week, 25h max, Monday-aligned weeks.
- Google OAuth consent screen must be **External + In production**.
- `useAuth()` must return safe defaults when context is undefined (prevents React Error #310 during SSR).
- Do **not** reintroduce "Blocked by dependencies" or task "labels" without discussion — both were deliberately removed.

## Deploy in tandem

When changing schema, update all three:
1. GitHub — push code.
2. Supabase — run migrations.
3. Vercel — no manual step; auto-deploys on push.

## Event shorthand

Used throughout workflow code: `#1` Starting Point, `#2` Oxbridge, `#3` Degree Apprenticeship, `#4` Great Lock-In. Abbreviations: `SCH` (Schools), `PTN` (Partnerships), `SS`, `ENG`. New modules should respect the same shorthand.
