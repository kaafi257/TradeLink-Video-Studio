import { describe, expect, it } from 'vitest';
import {
  canWriteCatalogue, checkImageFile, filterProducts, formatDate, formatPrice, MAX_IMAGE_BYTES, newImagePath,
  parseMoney, parseWhole, productPayload, sortProducts, validateProduct, videoEligible, type Product, type ProductForm,
} from './catalogue';

const blank: ProductForm = {
  name: 'Rice', description: '', category_id: '', supplier_id: '', brand: '', unit: '', package_size: '',
  min_order_quantity: '', retail_price: '', sale_price: '', stock_status: 'unknown', stock_quantity: '',
  image_approved: false, active: true,
};
const prod = (o: Partial<Product>): Product => ({
  id: 'x', name: 'P', description: null, category_id: null, supplier_id: null, brand: null, unit: null, package_size: null,
  min_order_quantity: null, retail_price: null, sale_price: null, stock_status: 'unknown', stock_quantity: null,
  image_path: null, image_approved: false, active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...o,
});

describe('permissions', () => {
  it('owner and editor write; viewer and inactive do not', () => {
    expect(canWriteCatalogue({ role: 'owner', active: true })).toBe(true);
    expect(canWriteCatalogue({ role: 'editor', active: true })).toBe(true);
    expect(canWriteCatalogue({ role: 'viewer', active: true })).toBe(false);
    expect(canWriteCatalogue({ role: 'editor', active: false })).toBe(false);
    expect(canWriteCatalogue(null)).toBe(false);
  });
});

describe('image rules', () => {
  it('accepts JPEG, PNG, WebP up to 10 MB only', () => {
    expect(checkImageFile({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(checkImageFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(checkImageFile({ type: 'image/webp', size: MAX_IMAGE_BYTES })).toBeNull();
    expect(checkImageFile({ type: 'image/gif', size: 1000 })).toBe('type');
    expect(checkImageFile({ type: 'application/pdf', size: 1000 })).toBe('type');
    expect(checkImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toBe('size');
    expect(checkImageFile({ type: 'image/png', size: 0 })).toBe('empty');
  });
  it('builds a path inside an allowed folder', () => {
    expect(newImagePath('products', 'image/webp', 'abc')).toBe('products/abc.webp');
    expect(() => newImagePath('products', 'image/gif', 'abc')).toThrow();
  });
});

describe('numbers', () => {
  it('parses money', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('12')).toBe(12);
    expect(parseMoney('12.5')).toBe(12.5);
    for (const bad of ['-1', '1.234', 'abc', '1,000', '1e3']) expect(parseMoney(bad)).toBe('invalid');
  });
  it('parses whole numbers with a minimum', () => {
    expect(parseWhole('', 1)).toBeNull();
    expect(parseWhole('5', 1)).toBe(5);
    expect(parseWhole('0', 1)).toBe('invalid');
    expect(parseWhole('0', 0)).toBe(0);
    expect(parseWhole('1.5', 0)).toBe('invalid');
  });
});

describe('product validation', () => {
  it('needs a name, nothing else', () => {
    expect(validateProduct(blank, false).ok).toBe(true);
    expect(validateProduct({ ...blank, name: '  ' }, false).errors.name).toBe('required');
  });
  it('sale price needs a higher retail price', () => {
    expect(validateProduct({ ...blank, sale_price: '5' }, false).errors.sale_price).toBe('saleNeedsRetail');
    expect(validateProduct({ ...blank, retail_price: '5', sale_price: '5' }, false).errors.sale_price).toBe('saleTooHigh');
    expect(validateProduct({ ...blank, retail_price: '10', sale_price: '5' }, false).ok).toBe(true);
  });
  it('approval needs an image', () => {
    expect(validateProduct({ ...blank, image_approved: true }, false).errors.image_approved).toBe('needsImage');
    expect(validateProduct({ ...blank, image_approved: true }, true).ok).toBe(true);
  });
  it('blank optional fields stay null; nothing is invented', () => {
    const p = productPayload(blank);
    expect(p.retail_price).toBeNull();
    expect(p.sale_price).toBeNull();
    expect(p.description).toBeNull();
    expect(p.stock_quantity).toBeNull();
    expect(p.stock_status).toBe('unknown');
  });
});

describe('video eligibility', () => {
  it('requires active, approved image', () => {
    expect(videoEligible(prod({ image_path: 'products/a.jpg', image_approved: true }))).toBe(true);
    expect(videoEligible(prod({ image_path: 'products/a.jpg', image_approved: false }))).toBe(false);
    expect(videoEligible(prod({ image_path: null, image_approved: true }))).toBe(false);
    expect(videoEligible(prod({ image_path: 'products/a.jpg', image_approved: true, active: false }))).toBe(false);
  });
});

describe('search, filter, sort', () => {
  const list = [
    prod({ id: '1', name: 'Rice', brand: 'Sela', category_id: 'c1', retail_price: 100, created_at: '2026-01-02T00:00:00Z' }),
    prod({ id: '2', name: 'Oil', category_id: 'c2', retail_price: 200, sale_price: 150, active: false, created_at: '2026-01-03T00:00:00Z' }),
    prod({ id: '3', name: 'Beans', description: 'Red beans', created_at: '2026-01-01T00:00:00Z' }),
  ];
  const f = (o: Partial<{ q: string; categoryId: string; status: 'all' | 'active' | 'inactive' }>) =>
    filterProducts(list, { q: '', categoryId: '', status: 'all', ...o }).map((p) => p.id);
  it('searches name, brand and description', () => {
    expect(f({ q: 'rice' })).toEqual(['1']);
    expect(f({ q: 'sela' })).toEqual(['1']);
    expect(f({ q: 'red' })).toEqual(['3']);
  });
  it('filters by category and status', () => {
    expect(f({ categoryId: 'c2' })).toEqual(['2']);
    expect(f({ categoryId: 'none' })).toEqual(['3']);
    expect(f({ status: 'active' })).toEqual(['1', '3']);
    expect(f({ status: 'inactive' })).toEqual(['2']);
  });
  it('sorts by the price a customer pays (sale price when set); unpriced products go last', () => {
    expect(sortProducts(list, 'name').map((p) => p.id)).toEqual(['3', '2', '1']);
    expect(sortProducts(list, 'newest').map((p) => p.id)).toEqual(['2', '1', '3']);
    expect(sortProducts(list, 'price_low').map((p) => p.id)).toEqual(['1', '2', '3']);
    expect(sortProducts(list, 'price_high').map((p) => p.id)).toEqual(['2', '1', '3']);
  });
});

describe('formatting', () => {
  it('formats ETB and Birr', () => {
    expect(formatPrice(1234.5, 'en')).toBe('ETB 1,234.50');
    expect(formatPrice(1234.5, 'am')).toBe('ብር 1,234.50');
  });
  it('formats dates numerically', () => {
    expect(formatDate('2026-12-01')).toBe('01/12/2026');
    expect(formatDate('2026-12-01T10:00:00Z')).toBe('01/12/2026');
    expect(formatDate(null)).toBe('');
  });
});
