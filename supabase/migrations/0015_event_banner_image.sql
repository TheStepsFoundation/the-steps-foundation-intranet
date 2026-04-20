-- Event banner + hub image support
--
-- Adds two nullable URL columns on events:
--   banner_image_url  — wide hero banner shown on /apply/<slug> public page
--   hub_image_url     — card-style image shown on student hub event cards
-- Both images live in a single public-read storage bucket 'event-banners'.
-- Write access is restricted to admin team members.

-- 1. Columns on events --------------------------------------------------------
alter table public.events
  add column if not exists banner_image_url text;

alter table public.events
  add column if not exists hub_image_url text;

comment on column public.events.banner_image_url is
  'Public URL of the wide hero banner (stored in event-banners bucket). Shown on /apply/<slug>.';

comment on column public.events.hub_image_url is
  'Public URL of the card-style image (stored in event-banners bucket). Shown on student hub event cards.';

-- 2. Storage bucket -----------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-banners',
  'event-banners',
  true,
  5 * 1024 * 1024,  -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3. Storage RLS --------------------------------------------------------------
-- Anyone (even anon) can read — banners render on public pages.
drop policy if exists "event banners public read" on storage.objects;
create policy "event banners public read"
  on storage.objects for select
  using (bucket_id = 'event-banners');

-- Admins can upload.
drop policy if exists "event banners admin insert" on storage.objects;
create policy "event banners admin insert"
  on storage.objects for insert
  with check (
    bucket_id = 'event-banners'
    and exists (
      select 1 from public.team_members
      where email = auth.jwt() ->> 'email'
        and role = 'admin'
    )
  );

-- Admins can replace (overwrite).
drop policy if exists "event banners admin update" on storage.objects;
create policy "event banners admin update"
  on storage.objects for update
  using (
    bucket_id = 'event-banners'
    and exists (
      select 1 from public.team_members
      where email = auth.jwt() ->> 'email'
        and role = 'admin'
    )
  );

-- Admins can delete (used when replacing an existing image).
drop policy if exists "event banners admin delete" on storage.objects;
create policy "event banners admin delete"
  on storage.objects for delete
  using (
    bucket_id = 'event-banners'
    and exists (
      select 1 from public.team_members
      where email = auth.jwt() ->> 'email'
        and role = 'admin'
    )
  );

-- 4. Focal point columns -----------------------------------------------------
-- Each image stores an (x, y) percent (0-100) that drives object-position when
-- the image is rendered inside its crop frame. Defaults to 50,50 (centre) so
-- existing behaviour is unchanged for events without an explicit focal point.

alter table public.events
  add column if not exists banner_focal_x numeric not null default 50,
  add column if not exists banner_focal_y numeric not null default 50,
  add column if not exists hub_focal_x    numeric not null default 50,
  add column if not exists hub_focal_y    numeric not null default 50;

do $$ begin
  alter table public.events add constraint banner_focal_x_range check (banner_focal_x >= 0 and banner_focal_x <= 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.events add constraint banner_focal_y_range check (banner_focal_y >= 0 and banner_focal_y <= 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.events add constraint hub_focal_x_range check (hub_focal_x >= 0 and hub_focal_x <= 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.events add constraint hub_focal_y_range check (hub_focal_y >= 0 and hub_focal_y <= 100);
exception when duplicate_object then null; end $$;
