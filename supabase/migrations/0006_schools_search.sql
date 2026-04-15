-- Schools: bulk loaded from GIAS edubasealldata (Open + non-primary).
-- Adds normalised search RPC backed by pg_trgm (word_similarity blended with similarity).
-- Picker queries via search_schools(q, lim) — SECURITY DEFINER, granted to anon/authenticated.

CREATE OR REPLACE FUNCTION public.norm_school_name(s text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT regexp_replace(lower(coalesce(s, '')), '[^a-z0-9 ]+', ' ', 'g')
$fn$;

CREATE OR REPLACE FUNCTION public.search_schools(q text, lim integer DEFAULT 15)
RETURNS TABLE(
  id uuid, urn integer, name text, town text, postcode text,
  phase text, type_group text, local_authority text, similarity real
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $fn$
  WITH q_norm AS (
    SELECT btrim(q) AS qq, public.norm_school_name(q) AS qn
  )
  SELECT s.id, s.urn, s.name, s.town, s.postcode, s.phase, s.type_group, s.local_authority,
         GREATEST(
           similarity(public.norm_school_name(s.name), qn.qn),
           word_similarity(qn.qn, public.norm_school_name(s.name))
         )::real AS similarity
  FROM public.schools s, q_norm qn
  WHERE qn.qq <> ''
    AND (
      public.norm_school_name(s.name) % qn.qn
      OR public.norm_school_name(s.name) <<% qn.qn
      OR qn.qn <% public.norm_school_name(s.name)
    )
  ORDER BY
    (public.norm_school_name(s.name) = qn.qn) DESC,
    word_similarity(qn.qn, public.norm_school_name(s.name)) DESC,
    similarity(public.norm_school_name(s.name), qn.qn) DESC,
    length(s.name) ASC
  LIMIT GREATEST(1, LEAST(lim, 50));
$fn$;

GRANT EXECUTE ON FUNCTION public.search_schools(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.norm_school_name(text) TO anon, authenticated;
