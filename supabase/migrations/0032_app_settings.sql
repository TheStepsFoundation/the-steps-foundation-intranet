-- =============================================================================
-- Steps Intranet — App-wide settings store
-- Date: 2026-05-18
--
-- A simple key/JSONB store backing the new /settings page so admins can edit
-- things that used to live as hardcoded constants (email signature, send caps,
-- per-event opt-out scope, event defaults). Code paths that need a value
-- read here at request time with a fallback constant if the row is missing,
-- so the table being empty isn't an outage condition.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.app_settings IS
  'Key/JSONB store for editable app settings. Backs the admin /settings page. Code reads with fallbacks so missing rows aren''t fatal.';

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_admin_all ON public.app_settings;
CREATE POLICY app_settings_admin_all ON public.app_settings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Authenticated reads are admin-only. The queue worker + send routes use the
-- service role key, which bypasses RLS, so they can read these values too.
