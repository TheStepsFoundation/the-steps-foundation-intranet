-- =============================================================================
-- Steps Intranet — drop applications.consent_given
-- Date: 2026-04-15
--
-- Rationale
-- ---------
-- `applications.consent_given` was defined in 0001 as a NOT NULL bool recording
-- "did the applicant consent at time of application". In practice this is
-- tautological: an applicant submitting a form with their contact details is,
-- by the act of submission, giving us the data for the purpose of processing
-- that application. The column would always be TRUE and carries no audit
-- value.
--
-- What actually matters is:
--   - `students.subscribed_to_mailing` — mutable marketing-subscription state,
--     flips to false on unsubscribe. Kept.
--   - `applications.consent_text_version` — the version of the privacy-notice
--     wording shown at intake. Useful for long-term audit. Kept.
--
-- The lawful basis for processing past applicants' data is legitimate
-- interests (charitable purpose, prior engagement), documented separately in
-- the DPIA — not per-row consent.
-- =============================================================================

alter table public.applications
  drop column if exists consent_given;

comment on column public.applications.consent_text_version is
  'Version tag of the privacy-notice / lawful-basis wording in effect on the form at time of submission. Not a consent capture — submission itself is sufficient for the "processing this application" purpose under legitimate interests. Use values like "v1.0" for new forms or "legacy_backfill_v1" for historically imported rows.';
