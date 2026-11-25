// Scene-plan generator (pure; no network). Builds editable scenes ONLY from approved catalogue data.
// It never invents prices, descriptions, stock or claims: a field that is empty produces no scene text.
import { formatPrice, videoEligible, type Campaign, type Product, type Supplier } from './catalogue';
import { TEMPLATES, templateFits, type TemplateId } from './templates';

export const VIDEO_TYPES = ['product_showcase', 'wholesale_offer', 'supplier_spotlight', 'campaign_promotion'] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];
export const DURATIONS = [15, 20, 30] as const;
export type Duration = (typeof DURATIONS)[number];
export const STYLES = ['premium', 'dynamic', 'minimal'] as const;
export type Style = (typeof STYLES)[number];
export const CTA_TYPES = ['whatsapp', 'telegram', 'phone', 'website'] as const;
export type CtaType = (typeof CTA_TYPES)[number];
export type Lang = 'en' | 'am' | 'so';

export type SceneType = 'intro' | 'product' | 'price' | 'wholesale' | 'supplier' | 'campaign' | 'cta' | 'outro';
export type Animation = 'none' | 'fade' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'slide_up' | 'slide_left' | 'reveal';

export interface Scene {
  position: number;
  scene_type: SceneType;
  duration_ms: number;
  headline: string | null;
  body: string | null;
  image_path: string | null;
  animation: Animation;
  /** Where each text came from, e.g. { headline: 'product.name' }. Text the owner typed is marked 'typed'. */
  source: Record<string, string>;
}

export interface Cta { type: CtaType; value: string }
export interface SceneInput {
  type: VideoType; language: Lang; duration: Duration; style: Style; cta: Cta;
  product?: Product | null; supplier?: Supplier | null; campaign?: Campaign | null;
  /** Supplier Spotlight only: true when a not-withdrawn supplier consent exists. */
  supplierConsent?: boolean;
  campaignProducts?: Product[];
  /** Optional template: sets pacing and animations. Without one, the style alone decides (the manual workflow). */
  templateId?: TemplateId | null;
}

export type PlanProblem =
  | 'noSubject' | 'productNotEligible' | 'needsMoq' | 'needsConsent' | 'supplierInactive' | 'campaignInactive' | 'noCta' | 'templateMismatch';
export type PlanResult =
  | { ok: true; scenes: Scene[]; draftLanguage: boolean }
  | { ok: false; problem: PlanProblem };

// Fixed interface labels (not business data). Amharic and Somali labels are DRAFT until a native speaker approves them.
const LABELS = {
  en: { moq: 'Minimum order', quote: 'Request a Quote', inStock: 'In stock', cta: { whatsapp: 'WhatsApp', telegram: 'Telegram', phone: 'Call', website: 'Visit' } },
  am: { moq: 'ዝቅተኛ ትዕዛዝ', quote: 'ዋጋ ይጠይቁ', inStock: 'ክምችት አለ', cta: { whatsapp: 'ዋትስአፕ', telegram: 'ቴሌግራም', phone: 'ይደውሉ', website: 'ድረ ገጽ' } },
  so: { moq: 'Tirada ugu yar ee dalabka', quote: 'Codso qiimo', inStock: 'Waa la heli karaa', cta: { whatsapp: 'WhatsApp', telegram: 'Telegram', phone: 'Soo wac', website: 'Booqo' } },
} as const;

const ANIM: Record<Style, { image: Animation[]; text: Animation }> = {
  premium: { image: ['zoom_in', 'zoom_out'], text: 'fade' },
  dynamic: { image: ['pan_left', 'pan_right', 'zoom_in'], text: 'slide_up' },
  minimal: { image: ['fade'], text: 'none' },
};

/** Split the total into integer milliseconds by weight; the parts always add up to exactly total. */
export function splitDuration(totalMs: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.round((totalMs * w) / sum / 100) * 100);
  parts[parts.length - 1] += totalMs - parts.reduce((a, b) => a + b, 0);
  return parts;
}

function priceText(p: Product, lang: Lang): { headline: string; body: string | null; source: Record<string, string> } | null {
  if (p.retail_price == null) return null;
  if (p.sale_price != null) {
    return { headline: formatPrice(p.sale_price, lang), body: formatPrice(p.retail_price, lang), source: { headline: 'product.sale_price', body: 'product.retail_price' } };
  }
  return { headline: formatPrice(p.retail_price, lang), body: null, source: { headline: 'product.retail_price' } };
}

function ctaText(c: Cta, lang: Lang): string {
  return `${LABELS[lang].cta[c.type]}: ${c.value.trim()}`;
}

interface Draft { type: SceneType; weight: number; headline?: string | null; body?: string | null; image?: string | null; source?: Record<string, string>; kind: 'image' | 'text' }

function finish(drafts: Draft[], input: SceneInput): PlanResult {
  const tpl = input.templateId ? TEMPLATES[input.templateId] : null;
  const ms = splitDuration(input.duration * 1000, drafts.map((d) => tpl?.weights[d.type] ?? d.weight));
  const a = tpl ? tpl.animations : ANIM[input.style];
  let img = 0;
  const scenes = drafts.map<Scene>((d, i) => ({
    position: i + 1,
    scene_type: d.type,
    duration_ms: ms[i]!,
    headline: d.headline ?? null,
    body: d.body ?? null,
    image_path: d.image ?? null,
    animation: d.kind === 'image' ? a.image[img++ % a.image.length]! : a.text,
    source: d.source ?? {},
  }));
  return { ok: true, scenes, draftLanguage: input.language !== 'en' };
}

export function generateScenes(input: SceneInput): PlanResult {
  const { type, language: lang } = input;
  if (input.cta.value.trim() === '') return { ok: false, problem: 'noCta' };
  if (input.templateId && !templateFits(input.templateId, type, input.duration)) return { ok: false, problem: 'templateMismatch' };
  const cta: Draft = { type: 'cta', weight: 3, headline: ctaText(input.cta, lang), source: { headline: 'cta' }, kind: 'text' };

  if (type === 'product_showcase' || type === 'wholesale_offer') {
    const p = input.product;
    if (!p) return { ok: false, problem: 'noSubject' };
    if (!videoEligible(p)) return { ok: false, problem: 'productNotEligible' };
    const drafts: Draft[] = [
      { type: 'intro', weight: 3, headline: p.name, image: p.image_path, source: { headline: 'product.name' }, kind: 'image' },
    ];
    const detail = [p.brand, p.package_size].filter((x): x is string => !!x && x.trim() !== '');
    if (detail.length || p.description) {
      drafts.push({
        type: 'product', weight: 4, headline: detail.join(' · ') || null, body: p.description, image: p.image_path, kind: 'image',
        source: { ...(detail.length ? { headline: 'product.brand/package_size' } : {}), ...(p.description ? { body: 'product.description' } : {}) },
      });
    }
    if (type === 'wholesale_offer') {
      if (p.min_order_quantity == null) return { ok: false, problem: 'needsMoq' };
      const unit = p.unit && p.unit.trim() !== '' ? ` ${p.unit.trim()}` : '';
      drafts.push({
        type: 'wholesale', weight: 4, headline: `${LABELS[lang].moq}: ${p.min_order_quantity}${unit}`, body: LABELS[lang].quote,
        source: { headline: 'product.min_order_quantity', body: 'label' }, kind: 'text',
      });
    } else {
      const pt = priceText(p, lang);
      if (pt) drafts.push({ type: 'price', weight: 3, headline: pt.headline, body: pt.body, source: pt.source, kind: 'text' });
      if (p.stock_status === 'in_stock') {
        drafts.push({ type: 'product', weight: 2, headline: LABELS[lang].inStock, source: { headline: 'product.stock_status' }, kind: 'text' });
      }
    }
    drafts.push(cta);
    return finish(drafts, input);
  }

  if (type === 'supplier_spotlight') {
    const s = input.supplier;
    if (!s) return { ok: false, problem: 'noSubject' };
    if (!s.active) return { ok: false, problem: 'supplierInactive' };
    if (!input.supplierConsent) return { ok: false, problem: 'needsConsent' };
    const meta = [s.industry, s.location].filter((x): x is string => !!x && x.trim() !== '');
    const drafts: Draft[] = [
      { type: 'intro', weight: 3, headline: s.name, image: s.logo_path, source: { headline: 'supplier.name' }, kind: 'image' },
    ];
    if (meta.length || s.description) {
      drafts.push({ type: 'supplier', weight: 4, headline: meta.join(' · ') || null, body: s.description, source: { ...(meta.length ? { headline: 'supplier.industry/location' } : {}), ...(s.description ? { body: 'supplier.description' } : {}) }, kind: 'text' });
    }
    drafts.push(cta);
    return finish(drafts, input);
  }

  const c = input.campaign;
  if (!c) return { ok: false, problem: 'noSubject' };
  if (!c.active) return { ok: false, problem: 'campaignInactive' };
  const drafts: Draft[] = [
    { type: 'intro', weight: 3, headline: c.name, image: c.banner_path, source: { headline: 'campaign.name' }, kind: 'image' },
  ];
  if (c.description) drafts.push({ type: 'campaign', weight: 3, body: c.description, source: { body: 'campaign.description' }, kind: 'text' });
  for (const p of (input.campaignProducts ?? []).filter(videoEligible).slice(0, 3)) {
    drafts.push({ type: 'product', weight: 3, headline: p.name, image: p.image_path, source: { headline: 'product.name' }, kind: 'image' });
  }
  drafts.push(cta);
  return finish(drafts, input);
}

/** Editors may reword scene text. Anything that is no longer the catalogue's text must be marked 'typed'. */
export function markTyped(scene: Scene, field: 'headline' | 'body', value: string | null): Scene {
  return { ...scene, [field]: value, source: { ...scene.source, [field]: 'typed' } };
}
