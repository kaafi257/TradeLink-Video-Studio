import { checkStudioConfig } from './config';

export const config = checkStudioConfig(
  import.meta.env.VITE_STUDIO_SUPABASE_URL,
  import.meta.env.VITE_STUDIO_SUPABASE_PUBLISHABLE_KEY,
);
