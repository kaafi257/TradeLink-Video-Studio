import { describe, expect, it } from 'vitest';
import type { Product, Supplier } from './catalogue';
import { applySuggestion, buildFacts, rulesCaption, rulesHashtags, rulesProvider, runCopy, shorten, type CopyProvider, type CopyRequest } from './copy';
import { claimsProblem, factsText } from './claimsGuard';
import type { Lang } from './scenes';

const base: Product = {
  id: 'p1', name: 'Fine Rice', description: 'Long grain rice, cleaned and packed.', category_id: null, supplier_id: null, brand: 'BrandX', unit: 'bag',
  package_size: '25 kg', min_order_quantity: 12, retail_price: 1200.5, sale_price: 999, stock_status: 'in_stock',
  stock_quantity: null, image_path: 'products/a.jpg', image_approved: true, active: true, created_at: '', updated_at: '',
};
const sup: Supplier = { id: 's1', name: 'Sup A', logo_path: null, industry: 'Grain', location: 'Addis Ababa', description: 'Family supplier.', active: true, created_at: '', updated_at: '' };
const cta = { type: 'phone', value: '+251911000000' } as const;
const facts = (type: 'product_showcase' | 'wholesale_offer', language: Lang = 'en', p: Product = base) => buildFacts({ type, language, cta, product: p });
const req = (f: ReturnType<typeof facts>, scope: CopyRequest['scope'] = 'all'): CopyRequest => ({
  facts: f, scope, scenes: [
    { position: 1, scene_type: 'intro', headline: 'Fine Rice', body: null },
    { position: 2, scene_type: 'product', headline: 'BrandX · 25 kg', body: 'x'.repeat(30) + ' ' + 'word '.repeat(40) },
  ],
});

describe('facts', () => {
  it('contains only approved, non-empty catalogue fields', () => {
    const f = buildFacts({ type: 'product_showcase', language: 'en', cta, product: { ...base, brand: null, description: '  ' } });
    expect(f.product).toEqual({ name: 'Fine Rice', unit: 'bag', package_size: '25 kg', min_order_quantity: 12, retail_price: 1200.5, sale_price: 999, stock_status: 'in_stock' });
    expect(JSON.stringify(f)).not.toContain('image_path');
    expect(JSON.stringify(f)).not.toContain('p1');
  });
});

describe('rules caption', () => {
  it('product showcase shows the current price, stock and the CTA, nothing else', () => {
    const c = rulesCaption(facts('product_showcase'));
    expect(c).toBe('Fine Rice · BrandX · 25 kg\nLong grain rice, cleaned and packed.\nETB 999.00\nIn stock\nCall: +251911000000');
  });
  it('wholesale shows MOQ and quote, never a price', () => {
    const c = rulesCaption(facts('wholesale_offer'));
    expect(c).toContain('Minimum order: 12 bag');
    expect(c).toContain('Request a Quote');
    expect(c).not.toContain('ETB');
  });
  it('works in Amharic and Somali', () => {
    expect(rulesCaption(facts('product_showcase', 'am'))).toContain('ብር 999.00');
    const so = rulesCaption(facts('wholesale_offer', 'so'));
    expect(so).toContain('Tirada ugu yar ee dalabka: 12 bag');
    expect(so).toContain('Codso qiimo');
  });
  it('supplier and campaign captions use only their own facts', () => {
    const f = buildFacts({ type: 'supplier_spotlight', language: 'en', cta, supplier: sup });
    expect(rulesCaption(f)).toBe('Sup A\nGrain · Addis Ababa\nFamily supplier.\nCall: +251911000000');
  });
  it('leaves out a line the guard would refuse instead of losing the caption', () => {
    const f = facts('product_showcase', 'en', { ...base, description: '100% cotton' });
    const c = rulesCaption(f);
    expect(c).not.toContain('100%');
    expect(c).toContain('Fine Rice');
  });
  it('every caption passes the claims guard in all languages and types', () => {
    for (const l of ['en', 'am', 'so'] as const) for (const t of ['product_showcase', 'wholesale_offer'] as const) {
      const f = facts(t, l);
      expect(claimsProblem(rulesCaption(f), factsText(f)), `${l}/${t}`).toBeNull();
    }
  });
  it('hashtags come only from the name and brand', () => {
    expect(rulesHashtags(facts('product_showcase'))).toEqual(['Fine', 'Rice', 'BrandX']);
  });
});

describe('runCopy (guard enforced for every provider)', () => {
  it('rules provider: caption, hashtags, and shortened long scene text', async () => {
    const r = await runCopy(rulesProvider, req(facts('product_showcase')));
    expect(r.ok && r.source).toBe('rules');
    if (!r.ok) return;
    expect(r.dropped).toEqual([]);
    expect(r.result.caption).toContain('Fine Rice');
    expect(r.result.scenes).toHaveLength(1);
    expect(r.result.scenes[0]!.position).toBe(2);
    expect(r.result.scenes[0]!.body!.length).toBeLessThanOrEqual(110);
    expect(r.result.scenes[0]!.body!.endsWith('…')).toBe(true);
  });
  it('scope "caption" returns no scenes; scope "scene" returns no caption', async () => {
    const a = await runCopy(rulesProvider, req(facts('product_showcase'), 'caption'));
    expect(a.ok && a.result.scenes).toEqual([]);
    const b = await runCopy(rulesProvider, { ...req(facts('product_showcase'), 'scene'), scenePosition: 2 });
    expect(b.ok && b.result.caption).toBeUndefined();
    expect(b.ok && b.result.scenes).toHaveLength(1);
  });
  const evil: CopyProvider = {
    id: 'local_ai',
    async generate() {
      return {
        scenes: [
          { position: 1, headline: 'Only ETB 85 today' },
          { position: 2, body: 'Fine rice, 12 per order' },
          { position: 9, body: 'wrong place' },
          { position: 2, body: 'duplicate' },
        ],
        caption: 'The best rice, 100% pure! www.x.com',
        hashtags: ['rice', 'bad tag', 'cheapest', 'BrandX', 'rice'],
      };
    },
  };
  it('drops invented prices, claims, bad positions and bad hashtags from a model', async () => {
    const r = await runCopy(evil, req(facts('product_showcase')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('local_ai');
    expect(r.result.scenes).toEqual([{ position: 2, body: 'Fine rice, 12 per order' }]);
    expect(r.result.caption).toBeUndefined();
    expect(r.result.hashtags).toEqual(['rice', 'BrandX']);
    expect(r.dropped.join('\n')).toMatch(/85/);
    expect(r.dropped.join('\n')).toMatch(/unexpected position/);
    expect(r.dropped.join('\n')).toMatch(/caption/);
  });
  it('a model that throws or returns junk never crashes the app', async () => {
    const boom: CopyProvider = { id: 'local_ai', async generate() { throw new Error('model offline'); } };
    expect(await runCopy(boom, req(facts('product_showcase')))).toEqual({ ok: false, error: 'model offline' });
    const junk: CopyProvider = { id: 'local_ai', async generate() { return { scenes: 'x', caption: 5, hashtags: 'y' } as never; } };
    const r = await runCopy(junk, req(facts('product_showcase')));
    expect(r.ok && r.result.scenes).toEqual([]);
  });
  it('too-long text is dropped', async () => {
    const long: CopyProvider = { id: 'local_ai', async generate() { return { scenes: [{ position: 1, headline: 'a'.repeat(201) }], caption: 'b'.repeat(2201) }; } };
    const r = await runCopy(long, req(facts('product_showcase')));
    expect(r.ok && r.result.scenes).toEqual([]);
    expect(r.ok && r.result.caption).toBeUndefined();
  });
});

describe('helpers', () => {
  it('shorten only ever shortens, at a word boundary', () => {
    expect(shorten('short', 20)).toBe('short');
    const s = shorten('one two three four five six seven', 15);
    expect(s.length).toBeLessThanOrEqual(15);
    expect(s.endsWith('…')).toBe(true);
    expect('one two three four five six seven').toContain(s.slice(0, -1));
  });
  it('applySuggestion records the source and leaves other fields alone', () => {
    const s = applySuggestion({ headline: 'a', body: 'b', source: { headline: 'product.name' } }, { position: 1, body: 'c' }, 'rules');
    expect(s).toEqual({ headline: 'a', body: 'c', source: { headline: 'product.name', body: 'rules' } });
  });
});
