import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './env';

// The Studio's own Supabase project only. No marketplace client exists in this phase.
export const supabase: SupabaseClient | null = config.ok
  ? createClient(config.url, config.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;
