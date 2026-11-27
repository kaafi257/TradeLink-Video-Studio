// sync-marketplace: copies categories, suppliers, products and product pictures from the TradeLink marketplace's
// PUBLIC views into this Studio's own database and private storage. Read-only towards the marketplace.
// Deno Edge Function. NOT deployed by Claude: the owner deploys it (see docs/PHASE-5-SYNC.md).
// Secrets (Studio project > Edge Functions > Secrets): MARKETPLACE_URL, MARKETPLACE_PUBLISHABLE_KEY.
// It runs with the SIGNED-IN OWNER's token. No service-role key is used.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runSync } from '../_shared/runner.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'Sign in first' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const result = await runSync({
    db: db as never,
    baseUrl: Deno.env.get('MARKETPLACE_URL') ?? '',
    key: Deno.env.get('MARKETPLACE_PUBLISHABLE_KEY') ?? '',
    fetchFn: (u: string, init: RequestInit) => fetch(u, init),
  });
  return result.ok ? json(200, { ok: true, ...result.summary }) : json(result.status, { ok: false, error: result.error });
});
