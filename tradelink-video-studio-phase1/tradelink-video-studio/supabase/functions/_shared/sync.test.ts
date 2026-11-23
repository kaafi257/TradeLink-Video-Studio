import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, VIEW_NAMES } from './allowlist.ts';
import { collectCatalogue, type FetchFn } from './sync.ts';

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const BASE = 'https://m.example.com';

describe('collectCatalogue', () => {
  it('pages until a short page and returns all ten views', async () => {
    const urls: string[] = [];
    const f: FetchFn = (url) => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      const view = new URL(url).pathname.split('/').pop();
      if (view === 'public_suppliers') return ok(offset === 0 ? Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: String(i) })) : [{ id: 'last' }]);
      return ok([]);
    };
    const r = await collectCatalogue({ baseUrl: BASE, key: 'k', fetchFn: f });
    expect(Object.keys(r).sort()).toEqual([...VIEW_NAMES].sort());
    expect(r.public_suppliers).toHaveLength(PAGE_SIZE + 1);
    expect(urls.every((u) => !u.includes('select=*'))).toBe(true);
  });
  it('uses GET with no redirects and sends only the publishable key', async () => {
    const seen: Array<Parameters<FetchFn>[1]> = [];
    await collectCatalogue({ baseUrl: BASE, key: 'pub', fetchFn: (_u, init) => { seen.push(init); return ok([]); } });
    expect(seen.length).toBe(VIEW_NAMES.length);
    for (const s of seen) { expect(s.method).toBe('GET'); expect(s.redirect).toBe('error'); expect(s.headers.apikey).toBe('pub'); }
  });
  it('fails the whole sync when any page fails', async () => {
    const f: FetchFn = (url) => url.includes('public_products?') ? Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(null) }) : ok([]);
    await expect(collectCatalogue({ baseUrl: BASE, key: 'k', fetchFn: f })).rejects.toThrow(/503/);
  });
  it('fails on an unexpected column', async () => {
    const f: FetchFn = (url) => url.includes('public_suppliers?') ? ok([{ id: '1', owner_email: 'x' }]) : ok([]);
    await expect(collectCatalogue({ baseUrl: BASE, key: 'k', fetchFn: f })).rejects.toThrow(/unexpected column/);
  });
  it('refuses a missing key or an unsafe address before any request', async () => {
    let called = 0;
    const f: FetchFn = () => { called++; return ok([]); };
    await expect(collectCatalogue({ baseUrl: BASE, key: '', fetchFn: f })).rejects.toThrow();
    await expect(collectCatalogue({ baseUrl: 'http://m.example.com', key: 'k', fetchFn: f })).rejects.toThrow();
    expect(called).toBe(0);
  });
  it('stops runaway pagination', async () => {
    const f: FetchFn = () => ok(Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: String(i) })));
    await expect(collectCatalogue({ baseUrl: BASE, key: 'k', fetchFn: f })).rejects.toThrow(/more than/);
  });
});
