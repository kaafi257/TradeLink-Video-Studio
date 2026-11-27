import { describe, expect, it } from 'vitest';
import { collect, SYNC_VIEWS, type FetchFn } from './collect.ts';
import { resolveImageUrl, sniffImage } from './images.ts';
import { runSync, type Db } from './runner.ts';

const BASE = 'https://m.example.com';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

function fakeFetch(views: Record<string, unknown[]>, images: Record<string, Uint8Array | number> = {}) {
  const calls: Array<{ url: string; method: string; redirect: string }> = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, method: init.method, redirect: init.redirect });
    const m = /\/rest\/v1\/(\w+)\?/.exec(url);
    if (m) {
      const all = views[m[1]!] ?? [];
      const off = Number(/offset=(\d+)/.exec(url)![1]);
      const lim = Number(/limit=(\d+)/.exec(url)![1]);
      return { ok: true, status: 200, json: async () => all.slice(off, off + lim), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const img = images[url];
    if (img === undefined || typeof img === 'number') return { ok: false, status: typeof img === 'number' ? img : 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => img.buffer.slice(img.byteOffset, img.byteOffset + img.byteLength) as ArrayBuffer };
  };
  return { fn, calls };
}

describe('collect', () => {
  it('reads only the five needed views, GET only, with the publishable key', async () => {
    const { fn, calls } = fakeFetch({});
    await collect({ baseUrl: BASE, key: 'sb_publishable_x', fetchFn: fn });
    const seen = calls.map((c) => /\/rest\/v1\/(\w+)\?/.exec(c.url)![1]);
    expect(seen).toEqual(SYNC_VIEWS);
    expect(seen).not.toContain('public_contact');
    expect(calls.every((c) => c.method === 'GET' && c.redirect === 'error')).toBe(true);
    expect(calls.every((c) => !c.url.includes('select=*'))).toBe(true);
  });
  it('pages through more than 500 rows', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ id: String(i), name: 'n' }));
    const { fn } = fakeFetch({ public_categories: rows });
    const out = await collect({ baseUrl: BASE, key: 'k', fetchFn: fn });
    expect(out.public_categories).toHaveLength(501);
  });
  it('refuses secret keys, unexpected columns and failed pages', async () => {
    await expect(collect({ baseUrl: BASE, key: 'sb_secret_abc', fetchFn: fakeFetch({}).fn })).rejects.toThrow(/secret key/);
    await expect(collect({ baseUrl: BASE, key: 'k', fetchFn: fakeFetch({ public_suppliers: [{ id: '1', name: 'a', phone: 'x' }] }).fn })).rejects.toThrow(/unexpected column/);
    const bad: FetchFn = async () => ({ ok: false, status: 500, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(collect({ baseUrl: BASE, key: 'k', fetchFn: bad })).rejects.toThrow(/500/);
    await expect(collect({ baseUrl: 'http://m.example.com', key: 'k', fetchFn: fakeFetch({}).fn })).rejects.toThrow();
  });
});

describe('picture safety', () => {
  const ok = `${BASE}/storage/v1/object/public/product-images/a/b.jpg`;
  it('accepts only the marketplace public buckets over https', () => {
    expect(resolveImageUrl(BASE, 'products', ok)).toBe(ok);
    expect(resolveImageUrl(BASE, 'suppliers', 'acme/logo.png')).toBe(`${BASE}/storage/v1/object/public/supplier-logos/acme/logo.png`);
    for (const bad of [
      'http://m.example.com/storage/v1/object/public/product-images/a.jpg',
      'https://evil.example.org/storage/v1/object/public/product-images/a.jpg',
      `${BASE}/storage/v1/object/public/private-docs/a.jpg`,
      `${BASE}/storage/v1/object/sign/product-images/a.jpg`,
      `${BASE}/storage/v1/object/public/product-images/../x.jpg`,
      'https://u:p@m.example.com/storage/v1/object/public/product-images/a.jpg',
      'javascript:alert(1)', '', 5, null,
    ]) expect(resolveImageUrl(BASE, 'products', bad as never)).toBeNull();
    expect(resolveImageUrl(BASE, 'products', 'acme/logo.png')).toBeNull(); // bare paths only for supplier logos
  });
  it('recognises real images by their first bytes', () => {
    expect(sniffImage(JPEG)?.ext).toBe('jpg');
    expect(sniffImage(PNG)?.ext).toBe('png');
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))?.ext).toBe('webp');
    expect(sniffImage(new TextEncoder().encode('<html>'))).toBeNull();
  });
});

function fakeDb(opts: { owner?: boolean; images?: unknown[]; applyError?: boolean } = {}) {
  const log: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const uploads: Array<{ bucket: string; path: string; type: string }> = [];
  const updates: Array<{ table: string; patch: Record<string, unknown>; id: string; nullCol: string | null }> = [];
  const db: Db = {
    rpc: async (name, args) => {
      log.push({ name, args });
      if (name === 'marketplace_start_run') return opts.owner === false ? { data: null, error: { message: 'Not allowed' } } : { data: 'run-1', error: null };
      if (name === 'marketplace_apply') return opts.applyError ? { data: null, error: { message: 'boom' } } : { data: { counts: { products_new: 1 }, skipped: [], images: opts.images ?? [] }, error: null };
      return { data: null, error: null };
    },
    storage: { from: (bucket) => ({ upload: async (path, _b, o) => { uploads.push({ bucket, path, type: o.contentType }); return { error: null }; } }) },
    from: (table) => ({ update: (patch) => ({ eq: (_c, id) => ({ is: (c) => ({ select: async () => { updates.push({ table, patch, id, nullCol: c }); return { data: [{ id }], error: null }; } }) }) }) }),
  };
  return { db, log, uploads, updates };
}

describe('runSync', () => {
  const img = `${BASE}/storage/v1/object/public/product-images/p1.jpg`;
  it('copies pictures into private storage and approves product pictures, only where empty', async () => {
    const f = fakeDb({ images: [{ kind: 'products', id: 'uuid-1', url: img }, { kind: 'suppliers', id: 'uuid-2', url: 'acme/logo.png' }] });
    const net = fakeFetch({}, { [img]: JPEG, [`${BASE}/storage/v1/object/public/supplier-logos/acme/logo.png`]: PNG });
    const r = await runSync({ db: f.db, baseUrl: BASE, key: 'k', fetchFn: net.fn });
    expect(r.ok).toBe(true);
    expect(f.uploads.map((u) => u.bucket)).toEqual(['source-images', 'source-images']);
    expect(f.uploads[0]!.path).toMatch(/^products\/uuid-1\/[0-9a-f]{12}\.jpg$/);
    expect(f.updates[0]).toMatchObject({ table: 'products', id: 'uuid-1', nullCol: 'image_path' });
    expect(f.updates[0]!.patch.image_approved).toBe(true);
    expect(f.updates[1]).toMatchObject({ table: 'suppliers', nullCol: 'logo_path' });
    expect(f.updates[1]!.patch.image_approved).toBeUndefined();
    expect(f.log.at(-1)).toMatchObject({ name: 'marketplace_finish_run', args: { p_status: 'succeeded' } });
    expect(net.calls.every((c) => c.method === 'GET')).toBe(true);
  });
  it('counts bad pictures and skips unsafe addresses without failing the sync', async () => {
    const f = fakeDb({ images: [
      { kind: 'products', id: 'a', url: img },
      { kind: 'products', id: 'b', url: 'https://evil.example.org/storage/v1/object/public/product-images/x.jpg' },
      { kind: 'products', id: 'c', url: `${BASE}/storage/v1/object/public/product-images/notimg.jpg` },
    ] });
    const net = fakeFetch({}, { [img]: 404, [`${BASE}/storage/v1/object/public/product-images/notimg.jpg`]: new TextEncoder().encode('<html>') });
    const r = await runSync({ db: f.db, baseUrl: BASE, key: 'k', fetchFn: net.fn });
    expect(r.ok && r.summary.pictures).toEqual({ copied: 0, failed: 2, remaining: 0, skipped: 1 });
    expect(f.uploads).toHaveLength(0);
    expect(net.calls.some((c) => c.url.includes('evil.example.org'))).toBe(false);
  });
  it('stops at the time budget and reports what is left', async () => {
    const f = fakeDb({ images: Array.from({ length: 5 }, (_, i) => ({ kind: 'products', id: `p${i}`, url: img })) });
    const net = fakeFetch({}, { [img]: JPEG });
    let t = 0;
    const r = await runSync({ db: f.db, baseUrl: BASE, key: 'k', fetchFn: net.fn, budgetMs: 25, now: () => (t += 10) });
    expect(r.ok && r.summary.pictures.remaining).toBeGreaterThan(0);
    expect(r.ok && r.summary.pictures.copied).toBeGreaterThan(0);
  });
  it('refuses non-owners and never reads the marketplace', async () => {
    const f = fakeDb({ owner: false });
    const net = fakeFetch({});
    const r = await runSync({ db: f.db, baseUrl: BASE, key: 'k', fetchFn: net.fn });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(net.calls).toHaveLength(0);
  });
  it('a failed read or save marks the run failed and applies nothing', async () => {
    const f = fakeDb();
    const bad: FetchFn = async () => ({ ok: false, status: 503, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
    const r = await runSync({ db: f.db, baseUrl: BASE, key: 'k', fetchFn: bad });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(f.log.map((l) => l.name)).toEqual(['marketplace_start_run', 'marketplace_finish_run']);
    expect(f.log[1]!.args).toMatchObject({ p_status: 'failed' });
    const g = fakeDb({ applyError: true });
    const r2 = await runSync({ db: g.db, baseUrl: BASE, key: 'k', fetchFn: fakeFetch({}).fn });
    expect(r2).toMatchObject({ ok: false, error: 'Saving the copy failed' });
    expect(g.log.at(-1)).toMatchObject({ name: 'marketplace_finish_run' });
  });
});
