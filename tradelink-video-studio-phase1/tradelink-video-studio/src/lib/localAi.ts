// Optional local AI (Stage 5). The app only asks the database for a copy job and reads the guarded result back.
// The AI itself runs on the owner's PC through the renderer program. Results are checked AGAIN here (runCopy) and are
// never saved by this module: a person reviews them and applies them.
import type { SupabaseClient } from '@supabase/supabase-js';
import { runCopy, type CopyProvider, type CopyRequest, type CopyResult } from './copy';

export type CopyJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface CopyJobRow { id: string; status: CopyJobStatus; result: CopyResult | null; error_message: string | null; provider: string | null; model: string | null; created_at: string }

export const POLL_MS = 2500;
export const GIVE_UP_MS = 5 * 60 * 1000;
export const HINT_AFTER_MS = 20 * 1000;

export async function requestLocalCopy(sb: SupabaseClient, project: string, scope: 'all' | 'caption' | 'scene', scene: number | null): Promise<{ id?: string; error?: string }> {
  const { data, error } = await sb.rpc('request_copy_job', { p_project: project, p_scope: scope, p_scene: scene });
  if (error) return { error: error.message };
  return { id: String(data) };
}

export async function readCopyJob(sb: SupabaseClient, id: string): Promise<CopyJobRow | null> {
  const { data, error } = await sb.from('copy_jobs').select('id,status,result,error_message,provider,model,created_at').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as CopyJobRow;
}

export async function cancelCopyJob(sb: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await sb.rpc('cancel_copy_job', { p_job: id });
  return !error;
}

/** Re-checks a stored AI result with the app's claims guard and limits. Source is always local_ai. */
export function guardLocalResult(result: CopyResult | null, req: CopyRequest) {
  const provider: CopyProvider = { id: 'local_ai', generate: async () => result ?? { scenes: [] } };
  return runCopy(provider, req);
}
