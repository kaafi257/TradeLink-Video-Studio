import { PAGE_SIZE, VIEW_NAMES, checkBaseUrl, checkRows, pageUrl, type ViewName } from './allowlist.ts';

export type FetchFn = (url: string, init: { method: 'GET'; headers: Record<string, string>; redirect: 'error'; signal: AbortSignal }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>;
}>;

export const MAX_PAGES_PER_VIEW = 40; // 20,000 rows per view; more than this fails the sync instead of guessing.

/**
 * Read all ten views, page by page. HTTP GET only. ANY failed page, bad response or unexpected
 * column throws, so the caller never has a partial copy.
 */
export async function collectCatalogue(opts: { baseUrl: string; key: string; fetchFn: FetchFn; timeoutMs?: number }): Promise<Record<ViewName, Record<string, unknown>[]>> {
  const base = checkBaseUrl(opts.baseUrl);
  if (!opts.key) throw new Error('MARKETPLACE_PUBLISHABLE_KEY is missing');
  const out = {} as Record<ViewName, Record<string, unknown>[]>;
  for (const view of VIEW_NAMES) {
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
