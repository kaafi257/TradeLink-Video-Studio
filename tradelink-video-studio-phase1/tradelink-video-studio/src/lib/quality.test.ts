import { describe, expect, it } from 'vitest';
import type { Product, Supplier } from './catalogue';
import { runQualityChecks, CHECK_IDS, type QualityInput } from './quality';
import { generateScenes, type Lang, type VideoType } from './scenes';
import { wrapLineCount } from './textFit';

const base: Product = {
  id: 'p1', name: 'Fine Rice', description: 'Long grain rice.', category_id: null, supplier_id: null, brand: 'BrandX', unit: 'bag', package_size: '25 kg',
  min_order_quantity: 12, retail_price: 1200.5, sale_price: 999, stock_status: 'in_stock', stock_quantity: null, image_path: 'products/a.jpg',
  image_approved: true, active: true, created_at: '', updated_at: '',
};
const sup: Supplier = { id: 's1', name: 'Sup A', logo_path: null, industry: 'Grain', location: 'Addis Ababa', description: 'Family supplier.', active: true, created_at: '', updated_at: '' };

function make(type: VideoType = 'product_showcase', lang: Lang = 'en', p: Product = base, templateId: string | null = null): QualityInput {
  const r = generateScenes({
    type, language: lang, duration: 20, style: 'premium', cta: { type: 'phone', value: '+251911000000' }, product: type === 'supplier_spotlight' ? null : p,
    supplier: type === 'supplier_spotlight' ? sup : null, supplierConsent: true,
  });
  if (!r.ok) throw new Error(r.problem);
  return {
    project: { video_type: type, language: lang, duration_seconds: 20, cta_type: 'phone', cta_value: '+251911000000', caption: 'Fine Rice', hashtags: ['rice'], template_id: templateId, style: 'premium' },
    scenes: r.scenes.map((s) => ({ position: s.position, scene_type: s.scene_type, duration_ms: s.duration_ms, headline: s.headline, body: s.body, image_path: s.image_path, source: s.source })),
    product: type === 'supplier_spotlight' ? null : p, supplier: type === 'supplier_spotlight' ? sup : null, consented: true,
  };
}
const status = (r: ReturnType<typeof runQualityChecks>, id: string) => r.checks.find((c) => c.id === id)?.status;

describe('quality assistant', () => {
  it('a fresh generated English product video passes everything', () => {
    const r = runQualityChecks(make());
    expect(r.checks.filter((c) => c.status !== 'pass')).toEqual([]);
    expect(r.status).toBe('pass');
  });
  it('every check id is known and reported at most once', () => {
    const r = runQualityChecks(make());
    const ids = r.checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(CHECK_IDS).toContain(id);
  });
  it('Somali and Amharic videos pass but carry a DRAFT warning', () => {
    for (const l of ['am', 'so'] as const) {
      const r = runQualityChecks(make('product_showcase', l));
      expect(status(r, 'draft_language'), l).toBe('warn');
      expect(r.checks.filter((c) => c.status === 'fail'), l).toEqual([]);
      expect(r.status).toBe('warn');
    }
  });
  it('fails when the scene times do not add up or there are too few scenes', () => {
    const i = make(); i.scenes[0]!.duration_ms += 3000;
    expect(status(runQualityChecks(i), 'time_total')).toBe('fail');
    const j = make(); j.scenes = j.scenes.slice(0, 2);
    expect(status(runQualityChecks(j), 'scene_count')).toBe('fail');
  });
  it('warns about very short scenes and long text', () => {
    const i = make(); i.scenes[1]!.duration_ms = 900;
    expect(runQualityChecks(i).checks.find((c) => c.id === 'scene_length')).toMatchObject({ status: 'warn', scenes: [2] });
    const j = make(); j.scenes[1]!.headline = 'word '.repeat(60);
    expect(status(runQualityChecks(j), 'text_fit')).toBe('warn');
  });
  it('fails without a contact for the call to action', () => {
    const i = make(); i.project.cta_value = '  ';
    expect(status(runQualityChecks(i), 'cta')).toBe('fail');
  });
  it('catches a price that no longer matches the catalogue', () => {
    const i = make(); i.product = { ...base, sale_price: 850 };
    expect(runQualityChecks(i).checks.find((c) => c.id === 'price_current')).toMatchObject({ status: 'fail' });
    const j = make(); j.product = { ...base, sale_price: null, retail_price: null };
    expect(status(runQualityChecks(j), 'price_current')).toBe('fail');
  });
  it('catches an "In stock" claim when stock is no longer in_stock', () => {
    const i = make(); i.product = { ...base, stock_status: 'out_of_stock' };
    expect(status(runQualityChecks(i), 'stock_claim')).toBe('fail');
  });
  it('catches a product that was deactivated or lost its approved image', () => {
    const i = make(); i.product = { ...base, active: false };
    expect(runQualityChecks(i).status).toBe('fail');
    const j = make(); j.product = { ...base, image_approved: false };
    expect(status(runQualityChecks(j), 'subject_ready')).toBe('fail');
  });
  it('wholesale: needs MOQ, shows no price, notices a changed MOQ', () => {
    const w = make('wholesale_offer');
    expect(runQualityChecks(w).status).toBe('pass');
    const noMoq = make('wholesale_offer'); noMoq.product = { ...base, min_order_quantity: null };
    expect(status(runQualityChecks(noMoq), 'wholesale_moq')).toBe('fail');
    const priced = make('wholesale_offer'); priced.scenes[2]!.headline = 'ETB 5.00';
    expect(status(runQualityChecks(priced), 'wholesale_no_price')).toBe('fail');
    const changed = make('wholesale_offer'); changed.product = { ...base, min_order_quantity: 24 };
    expect(status(runQualityChecks(changed), 'moq_current')).toBe('warn');
  });
  it('supplier spotlight needs consent', () => {
    const s = make('supplier_spotlight');
    expect(runQualityChecks(s).status).toBe('pass');
    s.consented = false;
    expect(status(runQualityChecks(s), 'consent')).toBe('fail');
  });
  it('claims: typed text warns, suggested text fails, nothing invented passes', () => {
    const typed = make(); typed.scenes[0]!.headline = 'The best rice in town'; typed.scenes[0]!.source = { headline: 'typed' };
    expect(runQualityChecks(typed).checks.find((c) => c.id === 'claims')).toMatchObject({ status: 'warn', scenes: [1] });
    const ai = make(); ai.scenes[0]!.headline = 'Only ETB 85 today'; ai.scenes[0]!.source = { headline: 'local_ai' };
    expect(runQualityChecks(ai).status).toBe('fail');
    const cap = make(); cap.project.caption = 'Save 20% now';
    expect(status(runQualityChecks(cap), 'claims')).toBe('warn');
  });
  it('caption limits and presence', () => {
    const i = make(); i.project.caption = 'x'.repeat(2201);
    expect(status(runQualityChecks(i), 'caption_limits')).toBe('fail');
    const j = make(); j.project.hashtags = Array.from({ length: 31 }, (_, k) => `t${k}`);
    expect(status(runQualityChecks(j), 'caption_limits')).toBe('fail');
    const k = make(); k.project.hashtags = ['bad tag'];
    expect(status(runQualityChecks(k), 'caption_limits')).toBe('fail');
    const e = make(); e.project.caption = '';
    expect(status(runQualityChecks(e), 'caption_present')).toBe('warn');
  });
  it('template that does not fit only warns', () => {
    expect(status(runQualityChecks(make('product_showcase', 'en', base, 'wholesale_offer')), 'template_fit')).toBe('warn');
    expect(status(runQualityChecks(make('product_showcase', 'en', base, 'clean_product')), 'template_fit')).toBe('pass');
  });
  it('rejects scene images outside the catalogue folders', () => {
    const i = make(); i.scenes[0]!.image_path = 'secrets/x.jpg';
    expect(status(runQualityChecks(i), 'image_folders')).toBe('fail');
  });
});

describe('text-fit model agrees with the renderer', () => {
  it('counts the same lines as renderer wrapByWidth on a corpus', async () => {
    // @ts-expect-error plain JS module of the renderer, compared on purpose
    const r = (await import('../../renderer/src/text.js')) as { wrapByWidth: (t: string, s: number, w: number, m: number) => string[] };
    const corpus = ['Fine Rice', 'Long grain rice, cleaned and packed for your shop in Addis Ababa', 'ሩዝ ጥራት ያለው ምርት ለሱቅዎ በጥሩ ዋጋ', 'Codso qiimo hadda soo wac nala xiriir',
      'WhatsApp: +251911000000', 'A'.repeat(80), 'ETB 1,200.50', 'one two three four five six seven eight nine ten eleven twelve'];
    for (const t of corpus) for (const size of [44, 68, 76, 88]) {
      const lines = r.wrapByWidth(t, size, 860, 99);
      expect(wrapLineCount(t, size, 860), `${t} @${size}`).toBe(lines.length);
    }
  });
});
