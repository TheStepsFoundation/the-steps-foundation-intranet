import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Explicit browser-only storage and auth config. Dropping the custom
// no-op lock: in newer @supabase/supabase-js versions it appears to
// interfere with session persistence (setSession returned no error but
// nothing landed in localStorage). If navigator.locks wedges again we'll
// switch to a proper lock implementation rather than a pass-through.
const isBrowser = typeof window !== 'undefined'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: isBrowser ? window.localStorage : undefined,
  },
})
