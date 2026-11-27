import { describe, expect, it } from 'vitest';
import type { Product } from './catalogue';
import { BATCH_MAX, runBatch, type BatchDeps } from './batch';

const full: Product = {
  id: 'p1', name: 'Fine Rice', description: 'Long grain rice.', category_id: null, supplier_id: null, brand: 'BrandX', unit: 'bag', package_size: '25 kg',
  min_order_quantity: 12, retail_price: 1200, sale_price: 999, stock_status: 'in_stock', stock_quantity: null, image_path: 'products/a.jpg',
  image_approved: true, active: true, created_at: '', updated_at: '',
};
const bare: Product = { ...full, id: 'p2', name: 'Bare', description: null, brand: null, unit: null, package_size: null, min_order_quantity: null, retail_price: null, sale_price: null, stock_status: 'unknown' };
const opts = (products: Product[], deps: BatchDeps, andQueue = false) => ({
  products, type: 'product_showcase' as const, language: 'en' as const, duration: 20 as const, style: 'premium' as const,
  cta: { type: 'phone' as const, value: '+251911000000' }, templateId: 'clean_product' as const, title: (p: Product) => p.name, andQueue, deps,
});

describe('batch create', () => {
  it('makes one draft per usable product and skips the ones with too little data, with a reason', async () => {
    const saved: string[] = [];
    const deps: BatchDeps = { save: async (a) => { saved.push(a.title); return `v-${a.subjectId}`; }, finish: async () => ({ kind: 'queued' }) };
    const r = await runBatch(opts([full, bare], deps));
    expect(r.map((x) => x.status)).toEqual(['draft', 'skipped']);
    expect(r[1]!.reasonKey).toBe('batch.tooFew');
    expect(saved).toEqual(['Fine Rice']);
  });
  it('with check-and-queue: queued, blocked and failed-to-queue are told apart', async () => {
    const outcomes = [{ kind: 'queued' as const }, { kind: 'blocked' as const, report: { status: 'fail' as const, checks: [] } }, { kind: 'error' as const }];
    let i = 0;
    const deps: BatchDeps = { save: async () => `v${i}`, finish: async () => outcomes[i++]! };
    const r = await runBatch(opts([full, { ...full, id: 'a' }, { ...full, id: 'b' }], deps, true));
    expect(r.map((x) => x.status)).toEqual(['queued', 'draft', 'draft']);
    expect(r.map((x) => x.reasonKey)).toEqual([undefined, 'batch.blocked', 'batch.queueError']);
  });
  it('one failed save does not stop the rest; a thrown error is contained', async () => {
    let n = 0;
    const deps: BatchDeps = { save: async () => { n++; if (n === 1) return null; if (n === 2) throw new Error('boom'); return 'ok'; }, finish: async () => ({ kind: 'queued' }) };
    const r = await runBatch(opts([full, { ...full, id: 'a' }, { ...full, id: 'b' }], deps));
    expect(r.map((x) => x.status)).toEqual(['error', 'error', 'draft']);
  });
  it('never makes more than the batch limit and reports progress', async () => {
    const many = Array.from({ length: BATCH_MAX + 5 }, (_, i) => ({ ...full, id: `x${i}` }));
    const seen: number[] = [];
    const deps: BatchDeps = { save: async () => 'v', finish: async () => ({ kind: 'queued' }) };
    const r = await runBatch({ ...opts(many, deps), onProgress: (d) => seen.push(d) });
    expect(r).toHaveLength(BATCH_MAX); expect(seen.at(-1)).toBe(BATCH_MAX);
  });
});
