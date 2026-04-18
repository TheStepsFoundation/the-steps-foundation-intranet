import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Using untyped client for flexibility - types handled in hooks.ts
// Custom lock: bypasses the browser navigator.locks API which can orphan
// during fast navigation or React Strict Mode double-mounts, causing
// getSession() to hang indefinitely. This no-op lock just runs the
// callback immediately — safe for a single-tab intranet app.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => {
      return await fn()
    },
  },
})
