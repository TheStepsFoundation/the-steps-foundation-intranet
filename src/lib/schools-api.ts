import { supabase } from './supabase'

export type School = {
  id: string
  urn: number
  name: string
  town: string | null
  postcode: string | null
  phase: string | null
  type_group: string | null
  local_authority: string | null
  similarity?: number
}

/**
 * Top-N fuzzy matches by trigram similarity on schools.name.
 * Backed by the search_schools Postgres function — the index does the work.
 */
export async function searchSchools(q: string, limit = 15): Promise<School[]> {
  const trimmed = q.trim()
  if (!trimmed) return []
  const { data, error } = await supabase.rpc('search_schools', { q: trimmed, lim: limit })
  if (error) throw error
  return (data ?? []) as School[]
}

export async function fetchSchoolById(id: string): Promise<School | null> {
  const { data, error } = await supabase
    .from('schools')
    .select('id,urn,name,town,postcode,phase,type_group,local_authority')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as School) ?? null
}
