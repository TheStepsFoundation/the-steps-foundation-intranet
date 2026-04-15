-- Generated normalised name + trigram index, so the manual review queue can fuzzy-match
-- 25 raw values against 10K schools in ~3s instead of timing out.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS name_norm text
  GENERATED ALWAYS AS (regexp_replace(lower(coalesce(name, '')), '[^a-z0-9 ]+', ' ', 'g')) STORED;

DROP INDEX IF EXISTS public.schools_norm_name_trgm;
CREATE INDEX IF NOT EXISTS schools_name_norm_trgm
  ON public.schools USING gin (name_norm gin_trgm_ops);

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS school_review_dismissed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.search_schools(q text, lim integer DEFAULT 15)
RETURNS TABLE(
  id uuid, urn integer, name text, town text, postcode text,
  phase text, type_group text, local_authority text, similarity real
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $fn$
  WITH q_norm AS (SELECT btrim(q) AS qq, public.norm_school_name(q) AS qn)
  SELECT s.id, s.urn, s.name, s.town, s.postcode, s.phase, s.type_group, s.local_authority,
         GREATEST(similarity(s.name_norm, qn.qn),
                  word_similarity(qn.qn, s.name_norm))::real AS similarity
  FROM public.schools s, q_norm qn
  WHERE qn.qq <> ''
    AND (s.name_norm % qn.qn OR s.name_norm <<% qn.qn OR qn.qn <% s.name_norm)
  ORDER BY (s.name_norm = qn.qn) DESC,
           word_similarity(qn.qn, s.name_norm) DESC,
           similarity(s.name_norm, qn.qn) DESC,
           length(s.name) ASC
  LIMIT GREATEST(1, LEAST(lim, 50));
$fn$;

CREATE OR REPLACE FUNCTION public.unlinked_school_review(
  per_raw integer DEFAULT 6,
  page_size integer DEFAULT 25,
  page_offset integer DEFAULT 0
)
RETURNS TABLE(
  raw text, student_count integer, student_ids uuid[],
  candidates jsonb, total_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $fn$
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
  ),
  total AS (SELECT COUNT(*)::int AS n FROM unlinked),
  page AS (
    SELECT * FROM unlinked
    ORDER BY student_count DESC, lower(raw)
    LIMIT GREATEST(1, LEAST(page_size, 100)) OFFSET GREATEST(0, page_offset)
  )
  SELECT p.raw, p.student_count, p.student_ids,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.rnk)
      FROM (
        SELECT s.id, s.name, s.town, s.postcode, s.phase, s.type_group,
               s.local_authority,
               round(GREATEST(similarity(s.name_norm, p.raw_norm),
                              word_similarity(p.raw_norm, s.name_norm))::numeric, 3) AS similarity,
               ROW_NUMBER() OVER (
                 ORDER BY (s.name_norm = p.raw_norm) DESC,
                          word_similarity(p.raw_norm, s.name_norm) DESC,
                          similarity(s.name_norm, p.raw_norm) DESC,
                          length(s.name) ASC
               ) AS rnk
        FROM public.schools s
        WHERE s.name_norm <<% p.raw_norm OR p.raw_norm <% s.name_norm
        ORDER BY (s.name_norm = p.raw_norm) DESC,
                 word_similarity(p.raw_norm, s.name_norm) DESC,
                 similarity(s.name_norm, p.raw_norm) DESC,
                 length(s.name) ASC
        LIMIT per_raw
      ) c
    ), '[]'::jsonb) AS candidates,
    (SELECT n FROM total) AS total_count
  FROM page p
  ORDER BY p.student_count DESC, lower(p.raw)
$fn$;

CREATE OR REPLACE FUNCTION public.link_students_by_raw(p_raw text, p_school_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $fn$
DECLARE n integer;
BEGIN
  UPDATE public.students
  SET school_id = p_school_id, school_review_dismissed = false
  WHERE school_id IS NULL AND btrim(school_name_raw) = btrim(p_raw);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

CREATE OR REPLACE FUNCTION public.dismiss_unlinked_raw(p_raw text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $fn$
DECLARE n integer;
BEGIN
  UPDATE public.students
  SET school_review_dismissed = true
  WHERE school_id IS NULL AND btrim(school_name_raw) = btrim(p_raw);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.unlinked_school_review(integer, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_students_by_raw(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_unlinked_raw(text) TO anon, authenticated;
