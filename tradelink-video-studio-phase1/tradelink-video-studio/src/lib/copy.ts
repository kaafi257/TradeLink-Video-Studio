// Copy engine (Phase 4, Stage 2). Suggests scene wording, a caption and hashtags from approved catalogue facts only.
// Providers: "rules" (deterministic, always available, built here) and "local_ai" (optional Ollama, added in Stage 5).
// EVERY provider's output goes through runCopy(), which applies the claims guard and the length limits.
// Suggestions are never saved automatically: a person reviews and applies them.
// Amharic and Somali wording produced here is DRAFT until a native speaker approves it.
import { formatPrice, type Campaign, type Product, type Supplier } from './catalogue';
import { claimsProblem, factsText } from './claimsGuard';
import { ctaText, labelsFor, type Cta, type Lang, type VideoType } from './scenes';

export interface CopyFacts {
  video_type: VideoType; language: Lang; cta_type: string; cta_value: string;
  product?: Partial<Pick<Product, 'name' | 'brand' | 'description' | 'unit' | 'package_size' | 'min_order_quantity' | 'retail_price' | 'sale_price' | 'stock_status'>>;
  supplier?: Partial<Pick<Supplier, 'name' | 'industry' | 'location' | 'description'>>;
  campaign?: Partial<Pick<Campaign, 'name' | 'description'>>;
}
export interface SceneSuggestion { position: number; headline?: string; body?: string }
export interface CopyResult { scenes: SceneSuggestion[]; caption?: string; hashtags?: string[] }
export interface CopyRequest {
  facts: CopyFacts;
  scenes: Array<{ position: number; scene_type: string; headline: string | null; body: string | null }>;
  scope: 'all' | 'caption' | 'scene';
  scenePosition?: number;
}
export type CopySource = 'rules' | 'local_ai';
export interface CopyProvider { id: CopySource; generate(req: CopyRequest): Promise<CopyResult> }

export const LIMITS = { headline: 200, body: 600, caption: 2200, hashtag: 60, hashtags: 30 } as const;

const clean = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === ''))) as T;

/** The facts a copy provider may use, built from the same approved rows the database uses. */
export function buildFacts(i: { type: VideoType; language: Lang; cta: Cta; product?: Product | null; supplier?: Supplier | null; campaign?: Campaign | null }): CopyFacts {
  const f: CopyFacts = { video_type: i.type, language: i.language, cta_type: i.cta.type, cta_value: i.cta.value.trim() };
  if (i.product) {
    const p = i.product;
    f.product = clean({ name: p.name, brand: p.brand, description: p.description, unit: p.unit, package_size: p.package_size,
      min_order_quantity: p.min_order_quantity, retail_price: p.retail_price, sale_price: p.sale_price, stock_status: p.stock_status });
  } else if (i.supplier) {
    const s = i.supplier;
    f.supplier = clean({ name: s.name, industry: s.industry, location: s.location, description: s.description });
  } else if (i.campaign) {
    f.campaign = clean({ name: i.campaign.name, description: i.campaign.description });
  }
  return f;
}

/** Cut text at a word boundary so it fits a scene. Only ever shortens; never adds words. */
export function shorten(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–·]+$/, '')}…`;
}

const SCENE_BODY_MAX = 110;

function words(...parts: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const part of parts) {
    for (const w of (part ?? '').split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 3 && w.length <= 30 && !/^\p{N}+$/u.test(w) && !out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w);
    }
  }
  return out;
}

export function rulesCaption(f: CopyFacts): string {
  const lang = f.language;
  const L = labelsFor(lang);
  const lines: string[] = [];
  const cta = ctaText({ type: f.cta_type as Cta['type'], value: f.cta_value }, lang);
  if (f.product) {
    const p = f.product;
    lines.push([p.name, p.brand, p.package_size].filter((x): x is string => !!x && x.trim() !== '').join(' · '));
    if (p.description) lines.push(shorten(p.description, 400));
    if (f.video_type === 'wholesale_offer') {
      if (p.min_order_quantity != null) lines.push(`${L.moq}: ${p.min_order_quantity}${p.unit ? ` ${p.unit}` : ''}`);
      lines.push(L.quote);
    } else {
      const price = p.sale_price ?? p.retail_price;
      if (price != null) lines.push(formatPrice(Number(price), lang));
      if (p.stock_status === 'in_stock') lines.push(L.inStock);
    }
  } else if (f.supplier) {
    const s = f.supplier;
    lines.push(s.name ?? '');
    const meta = [s.industry, s.location].filter((x): x is string => !!x && x.trim() !== '').join(' · ');
    if (meta) lines.push(meta);
    if (s.description) lines.push(shorten(s.description, 400));
  } else if (f.campaign) {
    lines.push(f.campaign.name ?? '');
    if (f.campaign.description) lines.push(shorten(f.campaign.description, 400));
  }
  lines.push(cta);
  // A line the claims guard would refuse (e.g. a description containing "%") is left out rather than losing the whole caption.
  const ft = factsText(f);
  return lines.filter((l) => l && claimsProblem(l, ft) === null).join('\n');
}

export function rulesHashtags(f: CopyFacts): string[] {
  const src = f.product ? words(f.product.name, f.product.brand) : f.supplier ? words(f.supplier.name, f.supplier.industry) : words(f.campaign?.name);
  return src.slice(0, 6);
}

export const rulesProvider: CopyProvider = {
  id: 'rules',
  async generate(req) {
    const out: CopyResult = { scenes: [] };
    if (req.scope !== 'caption') {
      for (const s of req.scenes) {
        if (req.scope === 'scene' && s.position !== req.scenePosition) continue;
        if (s.body && s.body.length > SCENE_BODY_MAX) out.scenes.push({ position: s.position, body: shorten(s.body, SCENE_BODY_MAX) });
      }
    }
    if (req.scope !== 'scene') { out.caption = rulesCaption(req.facts); out.hashtags = rulesHashtags(req.facts); }
    return out;
  },
};

export type CopyOutcome =
  | { ok: true; result: CopyResult; source: CopySource; dropped: string[] }
  | { ok: false; error: string };

/** Runs a provider and enforces the claims guard and limits on whatever it returns. Anything refused is dropped and listed. */
export async function runCopy(provider: CopyProvider, req: CopyRequest): Promise<CopyOutcome> {
  let raw: CopyResult;
  try { raw = await provider.generate(req); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'The provider failed' }; }
  const facts = factsText(req.facts);
  const dropped: string[] = [];
  const check = (label: string, text: string | undefined, max: number): string | undefined => {
    if (text === undefined || text === null) return undefined;
    if (typeof text !== 'string') { dropped.push(`${label}: not text`); return undefined; }
    if (text.length > max) { dropped.push(`${label}: too long`); return undefined; }
    const why = claimsProblem(text, facts);
    if (why) { dropped.push(`${label}: ${why}`); return undefined; }
    return text;
  };
  const known = new Set(req.scenes.map((s) => s.position));
  const scenes: SceneSuggestion[] = [];
  for (const s of Array.isArray(raw?.scenes) ? raw.scenes : []) {
    if (!known.has(s.position) || (req.scope === 'scene' && s.position !== req.scenePosition) || scenes.some((x) => x.position === s.position)) {
      dropped.push(`scene ${String(s.position)}: unexpected position`); continue;
    }
    const headline = check(`scene ${s.position} headline`, s.headline, LIMITS.headline);
    const body = check(`scene ${s.position} text`, s.body, LIMITS.body);
    if (headline !== undefined || body !== undefined) scenes.push({ position: s.position, ...(headline !== undefined ? { headline } : {}), ...(body !== undefined ? { body } : {}) });
  }
  const result: CopyResult = { scenes };
  const caption = check('caption', raw?.caption, LIMITS.caption);
  if (caption !== undefined) result.caption = caption;
  if (Array.isArray(raw?.hashtags)) {
    const tags: string[] = [];
    for (const h of raw.hashtags.slice(0, LIMITS.hashtags)) {
      if (typeof h !== 'string' || !/^[\p{L}\p{N}_]{1,60}$/u.test(h)) { dropped.push(`hashtag ${String(h)}: invalid`); continue; }
      const why = claimsProblem(h, facts);
      if (why) { dropped.push(`hashtag ${h}: ${why}`); continue; }
      if (!tags.some((x) => x.toLowerCase() === h.toLowerCase())) tags.push(h);
    }
    result.hashtags = tags;
  }
  return { ok: true, result, source: provider.id, dropped };
}

/** Applying one accepted suggestion to a scene. The source tag records where the words came from. */
export function applySuggestion<S extends { headline: string | null; body: string | null; source: Record<string, string> }>(
  scene: S, s: SceneSuggestion, source: CopySource,
): S {
  const next = { ...scene, source: { ...scene.source } };
  if (s.headline !== undefined) { next.headline = s.headline; next.source.headline = source; }
  if (s.body !== undefined) { next.body = s.body; next.source.body = source; }
  return next;
}
