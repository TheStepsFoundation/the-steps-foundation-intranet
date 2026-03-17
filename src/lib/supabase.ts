import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Using untyped client for flexibility - types handled in hooks.ts
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
