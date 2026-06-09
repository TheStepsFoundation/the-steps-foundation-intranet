-- ---------------------------------------------------------------------------
-- 0044_admin_guard_definer_rpcs.sql
--
-- Security Phase 2 (follow-up promised in 0043). Migrations 0042/0043 removed
-- anon access to the sensitive SECURITY DEFINER RPCs, but several remained
-- callable by ANY signed-in user (the generic `authenticated` role), incl.
-- students via /my. This adds an in-function is_admin() guard so only admin
-- team members can run them. Each function is reached in the app only through
-- the admin client (@/lib/supabase), so admin behaviour is unchanged.
--
-- Deliberately NOT guarded (already correctly self-authorising by caller email,
-- and used by the student-facing flow):
--   * withdraw_application(uuid)            -- student withdraws their OWN app
--   * get_latest_withdrawn_application(uuid)-- returns only the caller's own row
--
-- Applied via Supabase MCP at the same time this file landed in git.
-- is_admin() = (current_team_member_role() = 'admin'); coalesce'd to false so a
-- NULL (non-member) result is treated as "not admin".
-- ---------------------------------------------------------------------------

-- 1. promote_from_waitlist — MUTATING. Was the standout privilege-escalation:
--    a waitlisted student could self-promote to accepted. Now admin-only.
CREATE OR REPLACE FUNCTION public.promote_from_waitlist(p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_capacity int;
  v_accepted_count int;
  v_promoted_id uuid;
  v_old_status text;
BEGIN
  IF NOT coalesce(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Not authorised: admin only' USING ERRCODE = '42501';
  END IF;

  SELECT capacity INTO v_capacity FROM public.events WHERE id = p_event_id;

  SELECT count(*) INTO v_accepted_count
  FROM public.applications
  WHERE event_id = p_event_id
    AND status = 'accepted'
    AND deleted_at IS NULL;

  IF v_capacity IS NOT NULL AND v_accepted_count >= v_capacity THEN
    RETURN NULL;
  END IF;

  SELECT id, status INTO v_promoted_id, v_old_status
  FROM public.applications
  WHERE event_id = p_event_id
    AND status = 'waitlist'
    AND deleted_at IS NULL
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_promoted_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.applications
  SET status = 'accepted',
      reviewed_at = now(),
      decision_reason = 'Auto-promoted from waitlist',
      updated_at = now()
  WHERE id = v_promoted_id;

  INSERT INTO public.application_status_history (application_id, old_status, new_status, changed_by, note)
  VALUES (v_promoted_id, v_old_status, 'accepted', NULL, 'Auto-promoted from waitlist');

  RETURN v_promoted_id;
END;
$function$;

-- 2. link_students_by_raw — MUTATING. Could mis-link students to schools
--    (feeds eligibility via school_type). Now admin-only.
CREATE OR REPLACE FUNCTION public.link_students_by_raw(p_raw text, p_school_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF NOT coalesce(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Not authorised: admin only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.students
  SET school_id = p_school_id,
      school_review_dismissed = false
  WHERE school_id IS NULL
    AND btrim(school_name_raw) = btrim(p_raw);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;

-- 3. dismiss_unlinked_raw — MUTATING. Flag tampering on the review queue.
--    Now admin-only.
CREATE OR REPLACE FUNCTION public.dismiss_unlinked_raw(p_raw text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF NOT coalesce(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Not authorised: admin only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.students
  SET school_review_dismissed = true
  WHERE school_id IS NULL
    AND btrim(school_name_raw) = btrim(p_raw);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;

-- 4. unlinked_school_review(integer) — read-only, but leaked unlinked student
--    names/IDs to any signed-in user. Converted SQL -> plpgsql to allow an
--    in-function guard; query body unchanged. Now admin-only.
CREATE OR REPLACE FUNCTION public.unlinked_school_review(per_raw integer DEFAULT 6)
 RETURNS TABLE(raw text, student_count integer, student_ids uuid[], candidates jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT coalesce(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Not authorised: admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH unlinked AS (
    SELECT btrim(school_name_raw) AS raw,
           public.norm_school_name(school_name_raw) AS raw_norm,
           COUNT(*)::int AS student_count,
           array_agg(id) AS student_ids
    FROM public.students
    WHERE school_id IS NULL
      AND school_review_dismissed = false
      AND school_name_raw IS NOT NULL
      AND btrim(school_name_raw) <> ''
    GROUP BY btrim(school_name_raw), public.norm_school_name(school_name_raw)
  )
  SELECT u.raw, u.student_count, u.student_ids,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.rnk)
      FROM (
        SELECT s.id, s.name, s.town, s.postcode, s.phase, s.type_group,
               s.local_authority,
               round(GREATEST(similarity(s.name_norm, u.raw_norm),
                              word_similarity(u.raw_norm, s.name_norm))::numeric, 3) AS similarity,
               ROW_NUMBER() OVER (
                 ORDER BY (s.name_norm = u.raw_norm) DESC,
                          word_similarity(u.raw_norm, s.name_norm) DESC,
                          similarity(s.name_norm, u.raw_norm) DESC,
                          length(s.name) ASC
               ) AS rnk
        FROM public.schools s
        WHERE s.name_norm <<% u.raw_norm
           OR u.raw_norm <% s.name_norm
           OR s.name_norm % u.raw_norm
        ORDER BY (s.name_norm = u.raw_norm) DESC,
                 word_similarity(u.raw_norm, s.name_norm) DESC,
                 similarity(s.name_norm, u.raw_norm) DESC,
                 length(s.name) ASC
        LIMIT per_raw
      ) c
    ), '[]'::jsonb) AS candidates
  FROM unlinked u
  ORDER BY u.student_count DESC, lower(u.raw);
END;
$function$;

-- 5. unlinked_school_review(integer, integer, integer) — paginated overload.
--    Same treatment. Now admin-only.
CREATE OR REPLACE FUNCTION public.unlinked_school_review(per_raw integer DEFAULT 6, page_size integer DEFAULT 25, page_offset integer DEFAULT 0)
 RETURNS TABLE(raw text, student_count integer, student_ids uuid[], candidates jsonb, total_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT coalesce(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Not authorised: admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH grouped AS (
    SELECT btrim(school_name_raw) AS raw,
           COUNT(*)::int AS student_count,
           array_agg(id) AS student_ids
    FROM public.students
    WHERE school_id IS NULL
      AND school_review_dismissed = false
      AND school_name_raw IS NOT NULL
      AND btrim(school_name_raw) <> ''
    GROUP BY btrim(school_name_raw)
  ),
  unlinked AS (
    SELECT raw,
           public.school_match_expand(raw) AS raw_exp,
           public.school_match_core(public.school_match_expand(raw)) AS raw_core,
           student_count,
           student_ids
    FROM grouped
  ),
  total AS (SELECT COUNT(*)::int AS n FROM unlinked),
  page AS (
    SELECT * FROM unlinked
    ORDER BY student_count DESC, lower(raw)
    LIMIT GREATEST(1, LEAST(page_size, 100)) OFFSET GREATEST(0, page_offset)
  ),
  page_aug AS (
    SELECT *,
      CASE WHEN length(split_part(raw_core, ' ', 1)) >= 5
           THEN split_part(raw_core, ' ', 1) ELSE NULL END AS first_tok
    FROM page
  )
  SELECT p.raw, p.student_count, p.student_ids,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.rnk)
      FROM (
        SELECT s.id, s.name, s.town, s.postcode, s.phase, s.type_group, s.local_authority,
               round(GREATEST(
                 similarity(s.name_norm, p.raw_exp),
                 word_similarity(p.raw_exp, s.name_norm),
                 similarity(public.school_match_core(s.name_norm), p.raw_core),
                 word_similarity(p.raw_core, s.name_norm),
                 CASE WHEN p.first_tok IS NOT NULL
                      THEN word_similarity(p.first_tok, s.name_norm) * 0.85
                      ELSE 0 END
               )::numeric, 3) AS similarity,
               ROW_NUMBER() OVER (
                 ORDER BY GREATEST(
                   similarity(s.name_norm, p.raw_exp),
                   word_similarity(p.raw_exp, s.name_norm),
                   similarity(public.school_match_core(s.name_norm), p.raw_core),
                   word_similarity(p.raw_core, s.name_norm),
                   CASE WHEN p.first_tok IS NOT NULL
                        THEN word_similarity(p.first_tok, s.name_norm) * 0.85
                        ELSE 0 END
                 ) DESC,
                 length(s.name) ASC
               ) AS rnk
        FROM public.schools s
        WHERE s.name_norm <<% p.raw_exp
           OR p.raw_exp <% s.name_norm
           OR s.name_norm <<% p.raw_core
        ORDER BY GREATEST(
                   similarity(s.name_norm, p.raw_exp),
                   word_similarity(p.raw_exp, s.name_norm),
                   similarity(public.school_match_core(s.name_norm), p.raw_core),
                   word_similarity(p.raw_core, s.name_norm),
                   CASE WHEN p.first_tok IS NOT NULL
                        THEN word_similarity(p.first_tok, s.name_norm) * 0.85
                        ELSE 0 END
                 ) DESC,
                 length(s.name) ASC
        LIMIT per_raw
      ) c
    ), '[]'::jsonb) AS candidates,
    (SELECT n FROM total) AS total_count
  FROM page_aug p
  ORDER BY p.student_count DESC, lower(p.raw);
END;
$function$;
