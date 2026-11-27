// Picture safety for the marketplace copy. A picture is only fetched from the marketplace's own public storage,
// only from the three public buckets named in docs/MARKETPLACE_INTEGRATION.md, and only if it really is a JPEG, PNG or WebP.
export const IMAGE_BUCKETS = ['product-images', 'supplier-products', 'supplier-logos'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // matches the Studio's source-images bucket limit

export type Kind = 'products' | 'categories' | 'suppliers';

/** Turns a value from the marketplace into a full URL, or null. Plain storage paths of supplier logos are completed. */
export function resolveImageUrl(baseOrigin: string, kind: Kind, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 600) return null;
  let url: URL;
  try {
    if (/^https:\/\//i.test(v)) url = new URL(v);
    else if (kind === 'suppliers' && !/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.startsWith('//')) {
      url = new URL(`${baseOrigin}/storage/v1/object/public/supplier-logos/${v.replace(/^\/+/, '')}`);
    } else return null;
  } catch {
    return null;
  }
  if (url.origin !== baseOrigin || url.username || url.password || url.hash) return null;
  const m = /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(url.pathname);
  if (!m || !(IMAGE_BUCKETS as readonly string[]).includes(m[1]!)) return null;
  if (m[2]!.split('/').some((p) => p === '..' || p === '.' || p === '')) return null;
  return url.toString();
}

export function sniffImage(b: Uint8Array): { type: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { type: 'image/png', ext: 'png' };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { type: 'image/webp', ext: 'webp' };
  return null;
}

const TABLE: Record<Kind, { table: string; column: string }> = {
  products: { table: 'products', column: 'image_path' },
  categories: { table: 'categories', column: 'image_path' },
  suppliers: { table: 'suppliers', column: 'logo_path' },
};
export const targetFor = (k: Kind) => TABLE[k];
