import { createClient } from '@supabase/supabase-js'

// Either naming style works, so the snippet Supabase's dashboard offers can be pasted as is.
const env = import.meta.env
const url = env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
const key =
  env.VITE_SUPABASE_ANON_KEY ??
  env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Supabase is not configured: set the project URL and publishable key in .env.local, then restart the dev server.')
}

export const supabase = createClient(url, key)
