-- 0026_auth_users_null_string_defaults.sql
-- ---------------------------------------------------------------------------
-- The Supabase dashboard "Add user" button creates auth.users rows with NULL
-- values for several token/change columns. GoTrue's Go scanner then reads
-- those rows with `string` targets and bombs with:
--
--     error finding user: sql: Scan error on column index 8, name
--     "email_change": converting NULL to string is unsupported
--
-- Symptom: a student 500's on every sign-in attempt with "Database error
-- finding user", because the user lookup can't even deserialise the row.
--
-- Fix: give every string-scanned column a DEFAULT of the empty string, and
-- backfill any NULLs already in the table. This is safe — GoTrue treats '' as
-- "no pending change", identical to how it would read a freshly-signed-up
-- user, and Supabase's own SQL migrations to auth.users use the same pattern.
-- ---------------------------------------------------------------------------

-- Columns documented as NOT NULL + DEFAULT '' by GoTrue internally but
-- nullable in older Supabase auth schemas.
ALTER TABLE auth.users ALTER COLUMN email_change                SET DEFAULT '';
ALTER TABLE auth.users ALTER COLUMN email_change_token_new      SET DEFAULT '';
ALTER TABLE auth.users ALTER COLUMN email_change_token_current  SET DEFAULT '';
ALTER TABLE auth.users ALTER COLUMN phone_change                SET DEFAULT '';
ALTER TABLE auth.users ALTER COLUMN phone_change_token          SET DEFAULT '';
ALTER TABLE auth.users ALTER COLUMN reauthentication_token      SET DEFAULT '';
ALTER TABLE auth.users ALTER COLUMN confirmation_token          SET DEFAULT '';
ALTER TABLE auth.users ALTER COLUMN recovery_token              SET DEFAULT '';

-- Backfill any existing NULLs so current users don't trip the scanner.
UPDATE auth.users SET email_change                = '' WHERE email_change                IS NULL;
UPDATE auth.users SET email_change_token_new      = '' WHERE email_change_token_new      IS NULL;
UPDATE auth.users SET email_change_token_current  = '' WHERE email_change_token_current  IS NULL;
UPDATE auth.users SET phone_change                = '' WHERE phone_change                IS NULL;
UPDATE auth.users SET phone_change_token          = '' WHERE phone_change_token          IS NULL;
UPDATE auth.users SET reauthentication_token      = '' WHERE reauthentication_token      IS NULL;
UPDATE auth.users SET confirmation_token          = '' WHERE confirmation_token          IS NULL;
UPDATE auth.users SET recovery_token              = '' WHERE recovery_token              IS NULL;
