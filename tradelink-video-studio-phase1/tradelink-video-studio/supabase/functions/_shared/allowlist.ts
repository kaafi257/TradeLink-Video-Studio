// The ONLY marketplace views and columns the Studio may ever read (docs/MARKETPLACE_INTEGRATION.md).
// Pure TypeScript with no runtime imports, so Vitest and the Deno Edge Function share it.
export const ALLOWLIST = {
  public_campaign: ['id', 'scene', 'tag', 'title', 'body', 'cta_label', 'cta_action', 'sort_order', 'image_url'],
  public_categories: ['id', 'industry_id', 'name', 'description', 'image_url', 'sort_order'],
  public_contact: ['phone', 'whatsapp', 'telegram', 'email', 'address', 'working_hours'],
  public_industries: ['id', 'name', 'description', 'icon', 'sort_order', 'storefront'],
  public_product_images: ['id', 'product_id', 'url', 'sort_order'],
  public_products: [
    'id', 'name', 'category', 'description', 'image_url', 'unit', 'package_size', 'min_order_quantity',
    'category_id', 'audience', 'retail_price', 'brand', 'sale_price', 'created_at', 'stock_status',
    'stock_left', 'supplier_id',
  ],
  public_promo_products: ['promotion_id', 'product_id'],
  public_promotions: [
    'id', 'name', 'kind', 'scope', 'supplier_id', 'category_id', 'product_id', 'discount_type', 'percent',
    'amount', 'max_discount', 'buy_qty', 'get_qty', 'starts_at', 'ends_at', 'started_at', 'show_banner',
    'banner_text',
  ],
  public_supplier_categories: ['supplier_id', 'category_id'],
  public_suppliers: ['id', 'name', 'industry_id', 'location', 'about', 'logo_path'],
} as const;

export type ViewName = keyof typeof ALLOWLIST;
export const VIEW_NAMES = Object.keys(ALLOWLIST) as ViewName[];
export const PAGE_SIZE = 500;

// Views without a single `id` column cannot be ordered by id; each has a fixed stable order instead.
export const ORDER_BY: Record<ViewName, string> = {
  public_campaign: 'id',
  public_categories: 'id',
  public_contact: 'phone',
  public_industries: 'id',
  public_product_images: 'id',
  public_products: 'id',
  public_promo_products: 'promotion_id,product_id',
  public_promotions: 'id',
  public_supplier_categories: 'supplier_id,category_id',
  public_suppliers: 'id',
};

/** Fixed URL for one page. GET only; explicit columns; never select=*; no other parameters. */
export function pageUrl(base: string, view: ViewName, offset: number): string {
  if (!(view in ALLOWLIST)) throw new Error(`View not allowed: ${String(view)}`);
  const root = base.replace(/\/+$/, '');
  const select = ALLOWLIST[view].join(',');
  return `${root}/rest/v1/${view}?select=${select}&order=${ORDER_BY[view]}&limit=${PAGE_SIZE}&offset=${offset}`;
}

/** Reject any row that carries a column outside the allowlist, or is not a plain object. */
export function checkRows(view: ViewName, rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) throw new Error(`${view}: response is not a list`);
  if (rows.length > PAGE_SIZE) throw new Error(`${view}: page larger than ${PAGE_SIZE} rows`);
  const allowed = new Set<string>(ALLOWLIST[view]);
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${view}: row is not an object`);
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) throw new Error(`${view}: unexpected column "${key}"`);
    }
  }
  return rows as Record<string, unknown>[];
}

/** The marketplace address must be https and carry no path, query or credentials. */
export function checkBaseUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('MARKETPLACE_URL is not a valid address'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    throw new Error('MARKETPLACE_URL must be a plain https address');
  }
  return u.origin;
}
