-- =============================================================================
-- Steps Intranet — One application row per (student, event)
-- Date: 2026-05-18
--
-- Background: prior model soft-deleted (deleted_at + status='withdrew') the
-- application row on withdrawal, and re-applying inserted a fresh row with a
-- new UUID. This produced several downstream complications:
--   • Withdraw links signed over the original UUID became inert after re-apply
--   • Admin applicant queries needed special OR logic + app-side dedup
--   • A separate RPC was needed to surface prior raw_response on re-apply
--
-- New model: status='withdrew' stays a live row. Re-applying UPDATEs the same
-- row back to status='submitted' with fresh raw_response. application_id
-- becomes stable for the lifetime of (student, event) — which mirrors how the
-- application_status_history table already tracks transitions across attempts.
--
-- Admin soft-delete (deleted_at set on a non-withdrew row) is preserved for
-- the rare "this submission was erroneous and should disappear entirely"
-- workflow.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Backfill: collapse multi-row (student, event) pairs into one row.
--
-- Strategy: keep the OLDEST row's UUID so withdraw links already in the wild
-- (signed over that UUID) continue to resolve. Copy the *latest* status +
-- raw_response onto the keeper. Re-point application_status_history rows to
-- the keeper so the audit trail isn't orphaned. Then delete the discarded
-- rows.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pair       RECORD;
  keeper_id  uuid;
  latest_row applications%ROWTYPE;
  discard    uuid[];
BEGIN
  FOR pair IN
    SELECT student_id, event_id, COUNT(*) AS n
    FROM applications
    GROUP BY student_id, event_id
    HAVING COUNT(*) > 1
  LOOP
    -- Oldest UUID — preserves email-link compatibility for tokens already sent
    SELECT id INTO keeper_id FROM applications
    WHERE student_id = pair.student_id AND event_id = pair.event_id
    ORDER BY created_at ASC LIMIT 1;

    -- Latest meaningful state: prefer a live row; else the most recently
    -- soft-deleted withdrew row.
    SELECT * INTO latest_row FROM applications
    WHERE student_id = pair.student_id AND event_id = pair.event_id
      AND (deleted_at IS NULL OR status = 'withdrew')
    ORDER BY (deleted_at IS NULL) DESC, created_at DESC
    LIMIT 1;

    SELECT array_agg(id) INTO discard FROM applications
    WHERE student_id = pair.student_id AND event_id = pair.event_id
      AND id <> keeper_id;

    -- Re-point any history rows from the discarded UUIDs to the keeper
    -- BEFORE the delete, so a cascade FK doesn't take history rows with it.
    IF discard IS NOT NULL THEN
      UPDATE application_status_history
         SET application_id = keeper_id
       WHERE application_id = ANY(discard);
    END IF;

    -- DELETE the discards BEFORE we clear deleted_at on the keeper —
    -- otherwise the partial unique index applications_student_event_live_uniq
    -- (UNIQUE WHERE deleted_at IS NULL) fires: a discard row that's live
    -- would collide with the about-to-be-live keeper.
    IF discard IS NOT NULL THEN
      DELETE FROM applications WHERE id = ANY(discard);
    END IF;

    -- Project latest state onto the keeper, clear deleted_at.
    UPDATE applications SET
      status                 = latest_row.status,
      raw_response           = latest_row.raw_response,
      channel                = latest_row.channel,
      attribution_source     = latest_row.attribution_source,
      reviewed_at            = latest_row.reviewed_at,
      reviewed_by            = latest_row.reviewed_by,
      review_notes           = latest_row.review_notes,
      attended               = latest_row.attended,
      attended_at            = latest_row.attended_at,
      submitted_at           = latest_row.submitted_at,
      internal_review_status = latest_row.internal_review_status,
      internal_review_at     = latest_row.internal_review_at,
      internal_review_by     = latest_row.internal_review_by,
      bonus_points           = latest_row.bonus_points,
      bonus_reason           = latest_row.bonus_reason,
      decision_reason        = latest_row.decision_reason,
      consent_text_version   = latest_row.consent_text_version,
      is_test                = latest_row.is_test,
      updated_by             = latest_row.updated_by,
      deleted_at             = NULL,
      updated_at             = NOW()
      -- Deliberately NOT copied: id (keeper's), student_id, event_id (pair
      -- identity, identical anyway), created_at, created_by (the keeper IS
      -- the original creation — keep its provenance).
    WHERE id = keeper_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 2) Lone withdrew+soft-deleted rows: clear deleted_at so they're live again.
-- -----------------------------------------------------------------------------
UPDATE applications
   SET deleted_at = NULL,
       updated_at = NOW()
 WHERE status = 'withdrew'
   AND deleted_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3) The partial unique index from migration 0019 only applied to
--    `deleted_at IS NULL` rows. Under the new model, withdrew rows are also
--    live, so the partial filter is exactly what we still want (admin soft-
--    delete remains an escape hatch that allows re-apply via a fresh row).
--
--    We KEEP the partial index as-is — it now naturally enforces "one live
--    row per (student, event) regardless of status".
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 4) Rewrite withdraw_application: no longer stamps deleted_at.
--    Just sets status='withdrew', leaving the row live so re-apply UPDATE
--    semantics work.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_application(p_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status     text;
  v_student_email  text;
  v_caller_email   text := lower(auth.jwt() ->> 'email');
BEGIN
  IF v_caller_email IS NULL OR v_caller_email = '' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT a.status, s.personal_email
    INTO v_old_status, v_student_email
  FROM public.applications a
  JOIN public.students s ON s.id = a.student_id
  WHERE a.id = p_application_id
    AND a.deleted_at IS NULL;

  IF NOT FOUND THEN
    -- Row doesn't exist or has been admin-soft-deleted; treat as idempotent no-op.
    RETURN;
  END IF;

  IF v_student_email <> v_caller_email THEN
    RAISE EXCEPTION 'Not authorised to withdraw this application' USING ERRCODE = '42501';
  END IF;

  -- Already withdrawn? No-op (idempotent).
  IF v_old_status = 'withdrew' THEN
    RETURN;
  END IF;

  UPDATE public.applications
     SET status     = 'withdrew',
         updated_at = NOW()
   WHERE id = p_application_id;

  -- Best-effort history. A schema-level trigger may also fire — duplicate
  -- rows are acceptable in the append-only audit timeline.
  BEGIN
    INSERT INTO public.application_status_history (application_id, old_status, new_status, changed_by)
    VALUES (p_application_id, v_old_status, 'withdrew', NULL);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_application(uuid) TO authenticated;

COMMENT ON FUNCTION public.withdraw_application(uuid) IS
  'Student-initiated withdrawal. Sets status=withdrew without soft-deleting the row, so the same application_id persists across withdraw/re-apply cycles. Restricted to the JWT-matched student.';

-- -----------------------------------------------------------------------------
-- 5) get_latest_withdrawn_application is now redundant — RLS reveals the
--    withdrew row directly to the student (it's no longer soft-deleted).
--    Leave the function defined for one release cycle (any deployed client
--    calling it gets graceful empty rows) and remove in a follow-up migration.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_latest_withdrawn_application(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  raw_response jsonb,
  attribution_source text,
  channel text,
  withdrawn_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Under the new model the student can read their own withdrew row
  -- directly via RLS, so this function is a thin compatibility shim that
  -- returns the same shape. Safe to call from older deployed clients.
  SELECT
    a.id,
    a.raw_response,
    a.attribution_source,
    a.channel,
    a.updated_at AS withdrawn_at
  FROM public.applications a
  JOIN public.students s ON s.id = a.student_id
  WHERE a.event_id = p_event_id
    AND a.status = 'withdrew'
    AND a.deleted_at IS NULL
    AND s.personal_email = lower(auth.jwt() ->> 'email')
  ORDER BY a.updated_at DESC NULLS LAST
  LIMIT 1;
$$;

COMMIT;
