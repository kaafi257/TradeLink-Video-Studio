import { describe, expect, it } from 'vitest';
import { ALLOWLIST, ORDER_BY, PAGE_SIZE, VIEW_NAMES, checkBaseUrl, checkRows, pageUrl } from './allowlist.ts';

describe('marketplace allowlist', () => {
  it('has exactly the ten verified views', () => {
    expect([...VIEW_NAMES].sort()).toEqual([
      'public_campaign', 'public_categories', 'public_contact', 'public_industries', 'public_product_images',
      'public_products', 'public_promo_products', 'public_promotions', 'public_supplier_categories', 'public_suppliers',
    ]);
  });
  it('orders every view only by allowlisted columns', () => {
    for (const v of VIEW_NAMES) for (const c of ORDER_BY[v].split(',')) expect(ALLOWLIST[v] as readonly string[]).toContain(c);
  });
  it('builds explicit-column, bounded URLs and never select=*', () => {
    for (const v of VIEW_NAMES) {
      const url = pageUrl('https://m.example.com/', v, 500);
      expect(url).not.toContain('select=*');
      expect(url).toContain(`limit=${PAGE_SIZE}`);
      expect(url.startsWith(`https://m.example.com/rest/v1/${v}?select=`)).toBe(true);
    }
  });
  it('refuses a view outside the list', () => {
    expect(() => pageUrl('https://m.example.com', 'profiles' as never, 0)).toThrow();
  });
  it('rejects unexpected columns, oversize pages and non-lists', () => {
    expect(() => checkRows('public_suppliers', [{ id: '1', name: 'a', secret_phone: 'x' }])).toThrow(/unexpected column/);
    expect(() => checkRows('public_suppliers', { id: 1 })).toThrow(/not a list/);
    expect(() => checkRows('public_suppliers', new Array(PAGE_SIZE + 1).fill({ id: 1 }))).toThrow(/larger/);
    expect(checkRows('public_suppliers', [{ id: '1', name: 'a' }])).toHaveLength(1);
  });
  it('accepts only a plain https marketplace address', () => {
    expect(checkBaseUrl('https://abc.supabase.co/')).toBe('https://abc.supabase.co');
    for (const bad of ['http://abc.supabase.co', 'https://u:p@abc.supabase.co', 'https://abc.supabase.co/rest/v1', 'nope'])
      expect(() => checkBaseUrl(bad)).toThrow();
  });
});
