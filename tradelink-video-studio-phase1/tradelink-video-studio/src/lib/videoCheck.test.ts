import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Product } from './catalogue';
import { generateScenes } from './scenes';
import { checkFixQueue, fixTargets } from './videoCheck';
import type { QualityReport } from './quality';

const product: Product = {
  id: 'p1', name: 'Fine Rice', description: 'Long grain rice.', category_id: null, supplier_id: null, brand: 'BrandX', unit: 'bag', package_size: '25 kg',
  min_order_quantity: 12, retail_price: 1200, sale_price: 999, stock_status: 'in_stock', stock_quantity: null, image_path: 'products/a.jpg',
  image_approved: true, active: true, created_at: '', updated_at: '',
};

/** Tiny in-memory stand-in for the Supabase client: only what videoCheck uses. */
function fakeDb(opts: { catalogue: Product; scenesOf: Product }) {
  const gen = generateScenes({ type: 'product_showcase', language: 'en', duration: 20, style: 'premium', cta: { type: 'phone', value: '+251911000000' }, product: opts.scenesOf, supplierConsent: false });
  if (!gen.ok) throw new Error(gen.problem);
  const rows = gen.scenes.map((s, i) => ({ ...s, id: `sc${i}`, project_id: 'v1', updated_at: '' }));
  const project: Record<string, unknown> = {
    id: 'v1', title: 'T', video_type: 'product_showcase', product_id: 'p1', supplier_id: null, campaign_id: null, language: 'en', duration_seconds: 20,
    style: 'premium', cta_type: 'phone', cta_value: '+251911000000', caption: 'Fine Rice', hashtags: ['rice'], template_id: null, copy_source: 'rules',
    quality_report: null, quality_checked_at: null, status: 'draft', updated_at: '',
  };
  const log: string[] = [];
  const table = (name: string) => {
    const q: Record<string, unknown> = {};
    const result = (): { data: unknown; error: null } => {
      if (name === 'video_projects') return { data: project, error: null };
      if (name === 'video_scenes') return { data: rows, error: null };
      if (name === 'products') return { data: opts.catalogue, error: null };
      return { data: [], error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain, eq: () => chain, in: () => ({ ...result(), data: [] }), order: () => Promise.resolve(result()),
      maybeSingle: () => Promise.resolve(result()),
      update: (patch: Record<string, unknown>) => ({ eq: (_c: string, id: string) => { log.push(`update ${name} ${id}`); const r = rows.find((x) => x.id === id); if (r) Object.assign(r, patch); else if (name === 'video_projects') Object.assign(project, patch); return Promise.resolve({ error: null }); } }),
    };
    void q;
    return chain;
  };
  const db = { from: table, rpc: (fn: string) => { log.push(`rpc ${fn}`); return Promise.resolve({ error: null }); } } as unknown as SupabaseClient;
  return { db, log, rows };
}

describe('Create, check and queue', () => {
  it('queues a draft that passes', async () => {
    const { db, log } = fakeDb({ catalogue: product, scenesOf: product });
    expect(await checkFixQueue(db, 'v1')).toEqual({ kind: 'queued' });
    expect(log).toContain('rpc save_quality_report'); expect(log).toContain('rpc queue_video');
  });
  it('fixes a stale price from the catalogue, then queues', async () => {
    const { db, log, rows } = fakeDb({ catalogue: { ...product, sale_price: 900 }, scenesOf: product }); // price changed after the draft was made
    expect(await checkFixQueue(db, 'v1')).toEqual({ kind: 'queued' });
    expect(log.some((l) => l.startsWith('update video_scenes'))).toBe(true);
    expect(rows.find((r) => r.scene_type === 'price')!.headline).toBe('ETB 900.00');
  });
  it('stops, queues nothing, when a problem cannot be fixed automatically', async () => {
    const { db, log } = fakeDb({ catalogue: { ...product, image_approved: false }, scenesOf: product }); // picture no longer approved
    const out = await checkFixQueue(db, 'v1');
    expect(out.kind).toBe('blocked');
    expect(log).not.toContain('rpc queue_video');
  });
});

describe('fixTargets', () => {
  it('only offers fixes for wording problems, never for missing data', () => {
    const r: QualityReport = { status: 'fail', checks: [
      { id: 'price_current', status: 'fail', scenes: [2] }, { id: 'subject_ready', status: 'fail' }, { id: 'caption_present', status: 'warn' }, { id: 'scene_count', status: 'fail' },
    ] };
    const t = fixTargets(r);
    expect([...t.positions]).toEqual([2]); expect(t.caption).toBe(true);
    expect(fixTargets({ status: 'fail', checks: [{ id: 'subject_ready', status: 'fail' }] }).any).toBe(false);
  });
});
