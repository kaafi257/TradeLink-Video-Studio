// One marketplace sync, with everything outside this file injected so it can be tested with fakes.
// Runs AS THE SIGNED-IN OWNER (their token): no service-role key, and the database re-checks "owner" itself.
import { collect, type FetchFn } from './collect.ts';
import { checkBaseUrl } from './allowlist.ts';
import { MAX_IMAGE_BYTES, resolveImageUrl, sniffImage, targetFor, type Kind } from './images.ts';

export interface ImageJob { kind: Kind; id: string; url: string }
export interface Summary { counts: Record<string, number>; skipped: string[]; pictures: { copied: number; failed: number; remaining: number; skipped: number } }

// Minimal shape of the supabase-js client that this file uses.
export interface Db {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  storage: { from(bucket: string): { upload(path: string, body: Uint8Array, opts: { contentType: string; upsert: boolean }): Promise<{ error: { message: string } | null }> } };
  from(table: string): { update(v: Record<string, unknown>): { eq(c: string, v: string): { is(c: string, v: null): { select(c: string): Promise<{ data: unknown[] | null; error: { message: string } | null }> } } } };
}

export interface RunOptions {
  db: Db; baseUrl: string; key: string; fetchFn: FetchFn;
  now?: () => number; budgetMs?: number; maxImages?: number;
}

async function shortHash(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
  return Array.from(d.slice(0, 6)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function runSync(o: RunOptions): Promise<{ ok: true; summary: Summary } | { ok: false; error: string; status: number }> {
  const now = o.now ?? Date.now;
  const started = now();
  const budget = o.budgetMs ?? 100_000;
  let origin: string;
  try { origin = checkBaseUrl(o.baseUrl); } catch (e) { return { ok: false, error: (e as Error).message, status: 500 }; }

  const start = await o.db.rpc('marketplace_start_run');
  if (start.error || !start.data) return { ok: false, error: start.error?.message === 'Not allowed' ? 'Owner only' : 'A sync is already running', status: start.error?.message === 'Not allowed' ? 403 : 409 };
  const runId = String(start.data);

  const finish = (status: 'succeeded' | 'failed', summary: unknown, error: string | null) =>
    o.db.rpc('marketplace_finish_run', { p_run: runId, p_status: status, p_summary: summary, p_error: error });

  try {
    const payload = await collect({ baseUrl: origin, key: o.key, fetchFn: o.fetchFn });
    const applied = await o.db.rpc('marketplace_apply', { p_run: runId, p_payload: payload });
    if (applied.error) throw new Error('Saving the copy failed');
    const a = applied.data as { counts: Record<string, number>; skipped: string[]; images: Array<{ kind: Kind; id: string; url: string }> };

    const pics = { copied: 0, failed: 0, remaining: 0, skipped: 0 };
    const jobs = (a.images ?? []).slice(0, o.maxImages ?? 500);
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]!;
      if (now() - started > budget) { pics.remaining += jobs.length - i; break; }
      const url = resolveImageUrl(origin, job.kind, job.url);
      if (!url) { pics.skipped++; continue; }
      try {
        const res = await o.fetchFn(url, { method: 'GET', headers: { Accept: 'image/*' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) throw new Error('size');
        const kind = sniffImage(buf);
        if (!kind) throw new Error('not an image');
        const path = `${job.kind}/${job.id}/${await shortHash(buf)}.${kind.ext}`;
        const up = await o.db.storage.from('source-images').upload(path, buf, { contentType: kind.type, upsert: true });
        if (up.error) throw new Error('upload');
        const t = targetFor(job.kind);
        const patch: Record<string, unknown> = { [t.column]: path };
        if (job.kind === 'products') patch.image_approved = true; // owner chose: copied pictures are usable at once
        const upd = await o.db.from(t.table).update(patch).eq('id', job.id).is(t.column, null).select('id');
        if (upd.error) throw new Error('save');
        pics.copied++;
      } catch {
        pics.failed++;
      }
    }
    const summary: Summary = { counts: a.counts, skipped: a.skipped ?? [], pictures: pics };
    await finish('succeeded', summary, null);
    return { ok: true, summary };
  } catch (e) {
    const message = (e instanceof Error ? e.message : 'Sync failed').slice(0, 300);
    await finish('failed', {}, message);
    return { ok: false, error: message, status: 502 };
  }
}
