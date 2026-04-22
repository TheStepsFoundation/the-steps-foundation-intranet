// DB-backed reactive cache for the canonical list of events (used across every
// student-facing admin view). Replaces the stale hardcoded constants that used
// to live in students-api.ts.
//
// The shape the rest of the app consumed is preserved:
//   EVENTS       — ordered list (earliest date first) of small rendering-ready
//                  rows: { id, name, short, date }. Mutated in place on refresh
//                  so existing `.map(...)` call sites keep working; use the
//                  `useEvents()` hook when you need reactivity on rename.
//   EVENT_BY_ID  — record keyed by event id. Also mutated in place.
//
// On the first call to ensureEventsLoaded() (or the first render of a
// component subscribed via useEvents()) we fetch from the `events` table and
// populate the caches. Subsequent subscribers get the cached data immediately
// and re-render on any refreshEvents() call.
//
// `short` codes are derived from the event name (capital-letter initials, up
// to 3 chars, with a sensible fallback). Event names come straight from the
// event editor, so a rename in the editor now propagates to every student
// page, list, filter, and column header once the provider refreshes.

import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

export type EventMeta = {
  id: string
  name: string
  short: string
  /** Event date as YYYY-MM-DD (or empty string if not set). */
  date: string
}

/**
 * Mutated in place on every refresh so legacy `EVENTS.map(...)` calls that
 * capture the array at module load still see the latest data. Consumers that
 * need to re-render on change should subscribe via `useEvents()`.
 */
export const EVENTS: EventMeta[] = []

/**
 * Mutated in place in tandem with EVENTS.
 */
export const EVENT_BY_ID: Record<string, EventMeta> = {}

type StoreState = {
  version: number
  loaded: boolean
  error: string | null
  inFlight: Promise<void> | null
}

const state: StoreState = {
  version: 0,
  loaded: false,
  error: null,
  inFlight: null,
}

const listeners = new Set<() => void>()

const notify = () => {
  state.version++
  for (const fn of listeners) fn()
}

/**
 * Capital-letter initials up to 3 chars, falling back to the first 3 chars of
 * the name uppercased. "Starting Point" -> "SP". "The Great Lock-In" -> "TGL".
 * Events with no useful caps get e.g. "Workshop" -> "WOR".
 */
export const shortFor = (name: string): string => {
  const caps = name.match(/[A-Z]/g) ?? []
  if (caps.length >= 2) return caps.slice(0, 3).join('')
  const cleaned = name.replace(/[^A-Za-z0-9]/g, '')
  return cleaned.slice(0, 3).toUpperCase() || '???'
}

const applyRows = (rows: { id: string; name: string; event_date: string | null }[]) => {
  const sorted = [...rows].sort((a, b) => {
    const ad = a.event_date ?? ''
    const bd = b.event_date ?? ''
    if (ad && bd) return ad.localeCompare(bd)
    if (ad) return -1
    if (bd) return 1
    return a.name.localeCompare(b.name)
  })
  EVENTS.length = 0
  for (const r of sorted) {
    EVENTS.push({
      id: r.id,
      name: r.name,
      short: shortFor(r.name),
      date: r.event_date ?? '',
    })
  }
  for (const k of Object.keys(EVENT_BY_ID)) delete EVENT_BY_ID[k]
  for (const e of EVENTS) EVENT_BY_ID[e.id] = e
  state.loaded = true
  state.error = null
  notify()
}

const fetchEventsRaw = async () => {
  const { data, error } = await supabase
    .from('events')
    .select('id,name,event_date')
    .is('deleted_at', null)
    .order('event_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  applyRows(data as { id: string; name: string; event_date: string | null }[])
}

/**
 * Fetch the events list once (dedupes concurrent calls). Safe to call from
 * anywhere in the app; subsequent calls are no-ops until `refreshEvents()`.
 */
export const ensureEventsLoaded = async (): Promise<void> => {
  if (state.loaded) return
  if (state.inFlight) return state.inFlight
  const p = fetchEventsRaw()
    .catch(err => {
      state.error = err?.message ?? String(err)
      notify()
      throw err
    })
    .finally(() => {
      if (state.inFlight === p) state.inFlight = null
    })
  state.inFlight = p
  return p
}

/**
 * Force a re-fetch (e.g. after saving edits in the event editor). Resets the
 * loaded flag, so subscribers re-render with fresh data when it lands.
 */
export const refreshEvents = async (): Promise<void> => {
  state.loaded = false
  state.inFlight = null
  await ensureEventsLoaded()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  // Opportunistic first-load kick-off — the first hook mount triggers a fetch
  // if nothing has yet. Subsequent subscribers just re-use the cached data.
  if (!state.loaded && !state.inFlight) void ensureEventsLoaded()
  return () => { listeners.delete(fn) }
}

const getSnapshot = () => state.version

/**
 * React hook returning the current EVENTS array and an EVENT_BY_ID map,
 * re-rendering on refresh. Safe to call multiple times per component — the
 * store is a singleton.
 *
 *   const { events, byId, loaded } = useEvents()
 *
 * `events` and `byId` are the live mutable references (not snapshots) — they
 * survive refreshes because the arrays are mutated in place. That means you
 * can also import `EVENTS` directly in non-React utility code and always see
 * the latest data (so long as something has called ensureEventsLoaded()).
 */
export const useEvents = () => {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { events: EVENTS, byId: EVENT_BY_ID, loaded: state.loaded }
}
