// Pure catalogue rules (no browser or network code) so they can be unit tested.
import type { AppRole } from './roles';

export const STOCK_STATUSES = ['in_stock', 'low_stock', 'out_of_stock', 'unknown'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const CAMPAIGN_TYPES = ['promotion', 'seasonal', 'new_arrival', 'wholesale_offer', 'clearance', 'other'] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const IMAGE_FOLDERS = ['products', 'categories', 'suppliers', 'campaigns'] as const;
export type ImageFolder = (typeof IMAGE_FOLDERS)[number];

export const IMAGE_BUCKET = 'source-images';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // matches the bucket limit in 0002
export const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export interface Category { id: string; name: string; description: string | null; image_path: string | null; active: boolean; created_at: string; updated_at: string }
export interface Supplier { id: string; name: string; logo_path: string | null; industry: string | null; location: string | null; description: string | null; active: boolean; created_at: string; updated_at: string }
export interface Product {
  id: string; name: string; description: string | null; category_id: string | null; supplier_id: string | null;
  brand: string | null; unit: string | null; package_size: string | null; min_order_quantity: number | null;
  retail_price: number | null; sale_price: number | null; stock_status: StockStatus; stock_quantity: number | null;
  image_path: string | null; image_approved: boolean; active: boolean; created_at: string; updated_at: string;
}
export interface Campaign { id: string; name: string; campaign_type: CampaignType; description: string | null; banner_path: string | null; starts_on: string | null; ends_on: string | null; active: boolean; created_at: string; updated_at: string }

/** Owner and editors may write; viewers are read-only. (The database enforces the same rule.) */
export function canWriteCatalogue(profile: { role: AppRole; active: boolean } | null): boolean {
  return profile !== null && profile.active && (profile.role === 'owner' || profile.role === 'editor');
}

export type ImageProblem = 'type' | 'size' | 'empty' | null;
export function checkImageFile(file: { type: string; size: number }): ImageProblem {
  if (!(file.type in IMAGE_TYPES)) return 'type';
  if (file.size <= 0) return 'empty';
  if (file.size > MAX_IMAGE_BYTES) return 'size';
  return null;
}

export function newImagePath(folder: ImageFolder, mime: string, uuid: string): string {
  const ext = IMAGE_TYPES[mime];
  if (!ext) throw new Error('Unsupported image type');
  return `${folder}/${uuid}.${ext}`;
}

/** '' -> null (not supplied). Plain number with up to 2 decimals, not negative. Anything else -> 'invalid'. */
export function parseMoney(raw: string): number | null | 'invalid' {
  const s = raw.trim();
  if (s === '') return null;
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return 'invalid';
  return Number(s);
}

/** '' -> null. Whole number >= min. */
export function parseWhole(raw: string, min: number): number | null | 'invalid' {
  const s = raw.trim();
  if (s === '') return null;
  if (!/^\d{1,9}$/.test(s)) return 'invalid';
  const n = Number(s);
  return n >= min ? n : 'invalid';
}

export interface ProductForm {
  name: string; description: string; category_id: string; supplier_id: string; brand: string; unit: string;
  package_size: string; min_order_quantity: string; retail_price: string; sale_price: string;
  stock_status: StockStatus; stock_quantity: string; image_approved: boolean; active: boolean;
}
export type ProductErrorKey = 'name' | 'retail_price' | 'sale_price' | 'min_order_quantity' | 'stock_quantity' | 'image_approved';
export type ProductErrors = Partial<Record<ProductErrorKey, 'required' | 'invalid' | 'saleTooHigh' | 'saleNeedsRetail' | 'needsImage'>>;

export function validateProduct(f: ProductForm, hasImage: boolean): { errors: ProductErrors; ok: boolean } {
  const errors: ProductErrors = {};
  if (f.name.trim() === '') errors.name = 'required';
  const retail = parseMoney(f.retail_price);
  const sale = parseMoney(f.sale_price);
  if (retail === 'invalid') errors.retail_price = 'invalid';
  if (sale === 'invalid') errors.sale_price = 'invalid';
  if (typeof sale === 'number') {
    if (typeof retail !== 'number') errors.sale_price ??= 'saleNeedsRetail';
    else if (sale >= retail) errors.sale_price ??= 'saleTooHigh';
  }
  if (parseWhole(f.min_order_quantity, 1) === 'invalid') errors.min_order_quantity = 'invalid';
  if (parseWhole(f.stock_quantity, 0) === 'invalid') errors.stock_quantity = 'invalid';
  if (f.image_approved && !hasImage) errors.image_approved = 'needsImage';
  return { errors, ok: Object.keys(errors).length === 0 };
}

/** Row values for insert/update. Blank text becomes null: nothing is invented or defaulted. */
export function productPayload(f: ProductForm) {
  const text = (s: string) => (s.trim() === '' ? null : s.trim());
  return {
    name: f.name.trim(), description: text(f.description), category_id: f.category_id || null, supplier_id: f.supplier_id || null,
    brand: text(f.brand), unit: text(f.unit), package_size: text(f.package_size),
    min_order_quantity: parseWhole(f.min_order_quantity, 1) as number | null,
    retail_price: parseMoney(f.retail_price) as number | null, sale_price: parseMoney(f.sale_price) as number | null,
    stock_status: f.stock_status, stock_quantity: parseWhole(f.stock_quantity, 0) as number | null,
    image_approved: f.image_approved, active: f.active,
  };
}

/** Only an active product with an approved image may be used for video rendering (Phase 3 will call this). */
export function videoEligible(p: Pick<Product, 'active' | 'image_approved' | 'image_path' | 'name'>): boolean {
  return p.active && p.image_approved && !!p.image_path && p.name.trim() !== '';
}

export type StatusFilter = 'all' | 'active' | 'inactive';
export type SortKey = 'name' | 'newest' | 'price_low' | 'price_high';

export function filterProducts(list: Product[], o: { q: string; categoryId: string; status: StatusFilter }): Product[] {
  const q = o.q.trim().toLowerCase();
  return list.filter((p) => {
    if (o.status === 'active' && !p.active) return false;
    if (o.status === 'inactive' && p.active) return false;
    if (o.categoryId === 'none' ? p.category_id !== null : o.categoryId !== '' && p.category_id !== o.categoryId) return false;
    if (q === '') return true;
    return [p.name, p.brand, p.description].some((v) => (v ?? '').toLowerCase().includes(q));
  });
}

export function sortProducts(list: Product[], key: SortKey): Product[] {
  const price = (p: Product) => p.sale_price ?? p.retail_price;
  const copy = [...list];
  copy.sort((a, b) => {
    if (key === 'newest') return b.created_at.localeCompare(a.created_at);
    if (key === 'price_low' || key === 'price_high') {
      const pa = price(a), pb = price(b);
      if (pa === null && pb === null) return a.name.localeCompare(b.name);
      if (pa === null) return 1; // products without a price always last
      if (pb === null) return -1;
      return key === 'price_low' ? pa - pb : pb - pa;
    }
    return a.name.localeCompare(b.name);
  });
  return copy;
}

/** English: "ETB 1,234.50". Amharic: "ብር 1,234.50". */
export function formatPrice(n: number, lang: 'en' | 'am'): string {
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return lang === 'am' ? `ብር ${s}` : `ETB ${s}`;
}

/** YYYY-MM-DD or ISO timestamp -> DD/MM/YYYY (numeric, per the project conventions). */
export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
