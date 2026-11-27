// Reads ONLY the five public marketplace views the Studio needs for categories, suppliers, products and pictures.
// HTTP GET only, explicit columns, any failed page or unexpected column fails the whole read (no partial copy).
import { PAGE_SIZE, checkBaseUrl, checkRows, pageUrl, type ViewName } from './allowlist.ts';

export const SYNC_VIEWS: ViewName[] = ['public_industries', 'public_categories', 'public_suppliers', 'public_products', 'public_product_images'];
export const MAX_PAGES_PER_VIEW = 40; // 20,000 rows per view; more than this fails instead of guessing.

export type FetchFn = (url: string, init: { method: 'GET'; headers: Record<string, string>; redirect: 'error'; signal: AbortSignal }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer>;
}>;

export async function collect(opts: { baseUrl: string; key: string; fetchFn: FetchFn; timeoutMs?: number }): Promise<Record<string, Record<string, unknown>[]>> {
  const base = checkBaseUrl(opts.baseUrl);
  if (!opts.key) throw new Error('MARKETPLACE_PUBLISHABLE_KEY is missing');
  if (/^sb_secret_|service_role/i.test(opts.key)) throw new Error('A secret key was supplied. Only the PUBLISHABLE key may be used');
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const view of SYNC_VIEWS) {
    const all: Record<string, unknown>[] = [];
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES_PER_VIEW) throw new Error(`${view}: more than ${MAX_PAGES_PER_VIEW * PAGE_SIZE} rows`);
      const res = await opts.fetchFn(pageUrl(base, view, page * PAGE_SIZE), {
        method: 'GET',
        headers: { apikey: opts.key, Authorization: `Bearer ${opts.key}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) throw new Error(`${view}: marketplace answered ${res.status}`);
      const rows = checkRows(view, await res.json());
      all.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    out[view] = all;
  }
  return out;
}
