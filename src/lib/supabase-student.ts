/**
 * Student-hub Supabase client.
 *
 * Intentionally SEPARATE from the admin client in ./supabase. Both talk to
 * the same project — the only difference is the auth `storageKey`, which
 * partitions the two sessions in localStorage and (crucially) prevents
 * cross-tab `onAuthStateChange` broadcasts from leaking across scopes.
 *
 * Why this exists
 * ---------------
 * Before this split, signing in as a student in tab B (/my/sign-in) would
 * overwrite the shared `sb-<ref>-auth-token` key and broadcast SIGNED_IN to
 * tab A (admin on /students/events). The admin AuthProvider then saw an
 * unknown email, cleared teamMember, and StudentsLayout bounced to /login.
 *
 * With a dedicated student storageKey, the admin tab never sees the
 * student's auth event — the two clients are ships in the night.
 *
 * Usage
 * -----
 * Every student-facing module (`hub-api`, `apply-api`, `/my/*`, `/apply/*`)
 * must import from here, not from `./supabase`. The admin side continues
 * importing from `./supabase`.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const isBrowser = typeof window !== 'undefined'

// Derive a stable storageKey unique to student sessions. Using a fixed
// suffix (not the project ref) so admin and student don't collide even
// if the default naming changes in a future supabase-js version.
const STUDENT_STORAGE_KEY = 'sb-tsf-student-auth-token'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: isBrowser ? window.localStorage : undefined,
    storageKey: STUDENT_STORAGE_KEY,
  },
})
