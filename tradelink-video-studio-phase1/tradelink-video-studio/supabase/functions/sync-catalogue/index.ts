// sync-catalogue: copies the ten public marketplace views into this Studio's own database.
// Deno Edge Function. NOT deployed by Claude. Deploy it yourself after review (see docs/PHASE-2.md).
// Secrets (Studio project > Edge Function secrets): MARKETPLACE_URL, MARKETPLACE_PUBLISHABLE_KEY, NIGHTLY_SYNC_SECRET.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase for THIS project.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { collectCatalogue } from '../_shared/sync.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Who is calling? Either the nightly scheduler (shared secret) or a signed-in owner.
  let trigger: 'nightly' | 'manual';
  const secret = req.headers.get('x-sync-secret');
  if (secret !== null) {
    if (!sameSecret(secret, Deno.env.get('NIGHTLY_SYNC_SECRET') ?? '')) return json(401, { error: 'Not allowed' });
    const { data } = await service.from('app_settings').select('nightly_sync_enabled').maybeSingle();
    if (!data?.nightly_sync_enabled) return json(200, { skipped: 'Nightly sync is switched off' });
    trigger = 'nightly';
  } else {
    const auth = req.headers.get('Authorization') ?? '';
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: ok } = await asUser.rpc('is_owner');
    if (ok !== true) return json(403, { error: 'Owner only' });
    trigger = 'manual';
  }

  const { data: runId, error: startErr } = await service.rpc('catalogue_start_run', { p_trigger: trigger });
  if (startErr || !runId) return json(409, { error: 'A sync is already running' });

  try {
    const copy = await collectCatalogue({
      baseUrl: Deno.env.get('MARKETPLACE_URL') ?? '',
      key: Deno.env.get('MARKETPLACE_PUBLISHABLE_KEY') ?? '',
      fetchFn: (u, init) => fetch(u, init),
    });
    const { error } = await service.rpc('catalogue_replace', { p_run: runId, p_payload: copy });
    if (error) throw new Error('Saving the copy failed');
    const counts = Object.fromEntries(Object.entries(copy).map(([k, v]) => [k, v.length]));
    return json(200, { ok: true, counts });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Sync failed';
    await service.rpc('catalogue_fail_run', { p_run: runId, p_error: message });
    return json(502, { ok: false, error: message });   // previous copy is untouched
  }
});
