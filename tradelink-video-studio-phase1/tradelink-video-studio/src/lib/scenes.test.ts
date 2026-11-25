import { describe, expect, it } from 'vitest';
import type { Campaign, Product, Supplier } from './catalogue';
import { generateScenes, markTyped, splitDuration, type SceneInput } from './scenes';
import { TEMPLATE_IDS, TEMPLATES } from './templates';

const base: Product = {
  id: 'p1', name: 'Test Shirt', description: null, category_id: null, supplier_id: null, brand: null, unit: null,
  package_size: null, min_order_quantity: 12, retail_price: 100, sale_price: null, stock_status: 'unknown',
  stock_quantity: null, image_path: 'products/a.jpg', image_approved: true, active: true, created_at: '', updated_at: '',
};
const cta = { type: 'whatsapp', value: '+000' } as const;
const mk = (o: Partial<SceneInput>): SceneInput => ({ type: 'product_showcase', language: 'en', duration: 20, style: 'premium', cta, product: base, ...o });
const scenesOf = (i: SceneInput) => { const r = generateScenes(i); if (!r.ok) throw new Error(r.problem); return r.scenes; };

describe('splitDuration', () => {
  it('always adds up exactly', () => {
    for (const total of [15000, 20000, 30000]) for (const w of [[3, 3, 3], [3, 4, 3, 2, 3], [1, 1]]) {
      expect(splitDuration(total, w).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('product showcase', () => {
  it('uses only catalogue data and the exact length', () => {
    const s = scenesOf(mk({}));
    expect(s.reduce((a, x) => a + x.duration_ms, 0)).toBe(20000);
    expect(s[0]).toMatchObject({ scene_type: 'intro', headline: 'Test Shirt', image_path: 'products/a.jpg' });
    expect(s.at(-1)).toMatchObject({ scene_type: 'cta', headline: 'WhatsApp: +000' });
    expect(s.map((x) => x.position)).toEqual(s.map((_, i) => i + 1));
  });
  it('does not invent description, stock or price', () => {
    const s = scenesOf(mk({ product: { ...base, retail_price: null } }));
    expect(s.some((x) => x.scene_type === 'price')).toBe(false);
    expect(s.some((x) => x.headline === 'In stock')).toBe(false);
    expect(s.some((x) => x.body !== null)).toBe(false);
  });
  it('shows the sale price first with the retail price beside it', () => {
    const s = scenesOf(mk({ product: { ...base, sale_price: 80 } }));
    const price = s.find((x) => x.scene_type === 'price')!;
    expect(price.headline).toBe('ETB 80.00');
    expect(price.body).toBe('ETB 100.00');
    expect(price.source.headline).toBe('product.sale_price');
  });
  it('shows stock only when it is in stock', () => {
    expect(scenesOf(mk({ product: { ...base, stock_status: 'in_stock' } })).some((x) => x.headline === 'In stock')).toBe(true);
    expect(scenesOf(mk({ product: { ...base, stock_status: 'low_stock' } })).some((x) => x.headline === 'In stock')).toBe(false);
  });
  it('refuses products that are not usable for video', () => {
    for (const p of [{ ...base, active: false }, { ...base, image_approved: false }, { ...base, image_path: null }]) {
      expect(generateScenes(mk({ product: p }))).toEqual({ ok: false, problem: 'productNotEligible' });
    }
  });
});

describe('wholesale offer', () => {
  it('shows the minimum order and Request a Quote, and no price', () => {
    const s = scenesOf(mk({ type: 'wholesale_offer', product: { ...base, unit: 'pcs' } }));
    const w = s.find((x) => x.scene_type === 'wholesale')!;
    expect(w.headline).toBe('Minimum order: 12 pcs');
    expect(w.body).toBe('Request a Quote');
    expect(s.some((x) => x.scene_type === 'price')).toBe(false);
  });
  it('is blocked without a minimum order quantity', () => {
    expect(generateScenes(mk({ type: 'wholesale_offer', product: { ...base, min_order_quantity: null } }))).toEqual({ ok: false, problem: 'needsMoq' });
  });
});

describe('supplier spotlight', () => {
  const sup: Supplier = { id: 's1', name: 'Sup A', logo_path: 'suppliers/l.png', industry: 'Textiles', location: 'Addis Ababa', description: null, active: true, created_at: '', updated_at: '' };
  it('is blocked until consent is recorded', () => {
    expect(generateScenes(mk({ type: 'supplier_spotlight', supplier: sup, product: null }))).toEqual({ ok: false, problem: 'needsConsent' });
    expect(generateScenes(mk({ type: 'supplier_spotlight', supplier: sup, product: null, supplierConsent: true })).ok).toBe(true);
  });
});

describe('campaign promotion', () => {
  const camp: Campaign = { id: 'c1', name: 'Eid', campaign_type: 'seasonal', description: null, banner_path: null, starts_on: null, ends_on: null, active: true, created_at: '', updated_at: '' };
  it('uses only eligible products', () => {
    const s = scenesOf(mk({ type: 'campaign_promotion', campaign: camp, product: null, campaignProducts: [base, { ...base, id: 'p2', name: 'Hidden', image_approved: false }] }));
    expect(s.filter((x) => x.scene_type === 'product').map((x) => x.headline)).toEqual(['Test Shirt']);
  });
});

describe('Somali and templates', () => {
  const sup: Supplier = { id: 's1', name: 'Sup A', logo_path: 'suppliers/l.png', industry: 'Textiles', location: 'Addis Ababa', description: null, active: true, created_at: '', updated_at: '' };
  const camp: Campaign = { id: 'c1', name: 'Eid', campaign_type: 'seasonal', description: null, banner_path: null, starts_on: null, ends_on: null, active: true, created_at: '', updated_at: '' };
  const p = { ...base, stock_status: 'in_stock' as const, min_order_quantity: 12, unit: 'box' };
  it('flags Somali as DRAFT, keeps ETB and uses Somali labels', () => {
    const r = generateScenes(mk({ language: 'so', product: p, cta: { type: 'phone', value: '+000' } }));
    expect(r.ok && r.draftLanguage).toBe(true);
    expect(r.ok && r.scenes.find((x) => x.scene_type === 'price')!.headline).toContain('ETB');
    expect(r.ok && r.scenes.find((x) => x.scene_type === 'cta')!.headline).toContain('Soo wac');
    const w = generateScenes(mk({ language: 'so', type: 'wholesale_offer', product: p }));
    expect(w.ok && w.scenes.find((x) => x.scene_type === 'wholesale')!.body).toBe('Codso qiimo');
  });
  it('English is not flagged as DRAFT', () => {
    const r = generateScenes(mk({ product: p }));
    expect(r.ok && r.draftLanguage).toBe(false);
  });
  it('a template changes pacing and motion but never the text', () => {
    const plain = scenesOf(mk({ product: p }));
    const bold = scenesOf(mk({ product: p, templateId: 'bold_sale', style: 'dynamic' }));
    expect(bold.map((x) => x.headline)).toEqual(plain.map((x) => x.headline));
    expect(bold.map((x) => x.body)).toEqual(plain.map((x) => x.body));
    expect(bold.reduce((a, x) => a + x.duration_ms, 0)).toBe(20000);
    const price = bold.find((x) => x.scene_type === 'price')!;
    expect(price.duration_ms).toBeGreaterThan(plain.find((x) => x.scene_type === 'price')!.duration_ms);
    expect(bold.at(-1)!.animation).toBe('slide_up');
  });
  it('refuses a template that does not fit the video type or length', () => {
    expect(generateScenes(mk({ product: p, templateId: 'wholesale_offer' }))).toEqual({ ok: false, problem: 'templateMismatch' });
    expect(generateScenes(mk({ product: p, templateId: 'story_quick', duration: 30 }))).toEqual({ ok: false, problem: 'templateMismatch' });
  });
  it('every template keeps scene times adding up exactly', () => {
    for (const id of TEMPLATE_IDS) {
      const t = TEMPLATES[id];
      for (const type of t.videoTypes) for (const d of t.durations) {
        const r = generateScenes(mk({ type, duration: d, templateId: id, product: p, supplier: sup, supplierConsent: true, campaign: camp, campaignProducts: [p] }));
        expect(r.ok, `${id}/${type}/${d}`).toBe(true);
        if (r.ok) expect(r.scenes.reduce((a, x) => a + x.duration_ms, 0)).toBe(d * 1000);
      }
    }
  });
  it('without a template the manual workflow is unchanged', () => {
    const a = scenesOf(mk({ product: p }));
    const b = scenesOf(mk({ product: p, templateId: null }));
    expect(b).toEqual(a);
  });
});

describe('general', () => {
  it('flags Amharic as DRAFT and uses Birr script', () => {
    const r = generateScenes(mk({ language: 'am', product: { ...base, stock_status: 'in_stock' } }));
    expect(r.ok && r.draftLanguage).toBe(true);
    expect(r.ok && r.scenes.find((x) => x.scene_type === 'price')!.headline).toContain('ብር');
  });
  it('needs a call to action', () => {
    expect(generateScenes(mk({ cta: { type: 'phone', value: '  ' } }))).toEqual({ ok: false, problem: 'noCta' });
  });
  it('marks reworded text as typed', () => {
    const s = markTyped(scenesOf(mk({}))[0]!, 'headline', 'New words');
    expect(s.source.headline).toBe('typed');
  });
  it('minimal style avoids motion on text scenes', () => {
    const s = scenesOf(mk({ style: 'minimal' }));
    expect(s.at(-1)!.animation).toBe('none');
  });
});
