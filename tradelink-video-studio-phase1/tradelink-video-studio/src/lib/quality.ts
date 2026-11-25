// Quality Assistant (Phase 4, Stage 4): checks a DRAFT video against the current approved catalogue data before it is queued.
// Rule-based and deterministic, no AI. A "fail" blocks queueing (the database enforces this too); a "warn" lets you go on.
import { formatPrice, type Campaign, type Product, type Supplier } from './catalogue';
import { claimsProblem, factsText } from './claimsGuard';
import { buildFacts } from './copy';
import { labelsFor, type CtaType, type Lang, type VideoType } from './scenes';
import { isTemplateId, templateFits } from './templates';
import { wrapLineCount } from './textFit';
import type { VideoProject, VideoSceneRow } from './videos';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface QualityCheck { id: QualityCheckId; status: CheckStatus; scenes?: number[]; detail?: string }
export interface QualityReport { status: CheckStatus; checks: QualityCheck[] }

export const CHECK_IDS = [
  'scene_count', 'time_total', 'scene_length', 'text_fit', 'cta', 'subject_ready', 'image_folders', 'wholesale_moq', 'wholesale_no_price',
  'price_current', 'moq_current', 'stock_claim', 'consent', 'caption_limits', 'caption_present', 'claims', 'draft_language', 'template_fit',
] as const;
export type QualityCheckId = (typeof CHECK_IDS)[number];

export interface QualityInput {
  project: Pick<VideoProject, 'video_type' | 'language' | 'duration_seconds' | 'cta_type' | 'cta_value' | 'caption' | 'hashtags' | 'template_id' | 'style'>;
  scenes: Array<Pick<VideoSceneRow, 'position' | 'scene_type' | 'duration_ms' | 'headline' | 'body' | 'image_path' | 'source'>>;
  product?: Product | null;
  supplier?: Supplier | null;
  campaign?: Campaign | null;
  consented?: boolean;
}

const IMAGE_FOLDERS = ['products', 'categories', 'suppliers', 'campaigns'];
const STYLE_SIZES = { premium: { hs: 76, bs: 44 }, dynamic: { hs: 88, bs: 48 }, minimal: { hs: 68, bs: 42 } } as const;
const USABLE = 860;

/** Does the text on this scene fit without being cut? Conservative (uses the largest template size). */
function textCut(s: QualityInput['scenes'][number], style: string): boolean {
  const sz = STYLE_SIZES[style as keyof typeof STYLE_SIZES] ?? STYLE_SIZES.premium;
  const withImage = !!s.image_path && !['price', 'cta', 'wholesale'].includes(s.scene_type);
  const headSize = s.scene_type === 'price' ? 76 : s.scene_type === 'cta' ? 46 : withImage ? sz.hs + 8 : 56;
  const headMax = withImage ? 2 : 3;
  const bodyMax = withImage ? 3 : 4;
  if (s.headline && wrapLineCount(s.headline, headSize, USABLE) > headMax) return true;
  if (s.body && s.scene_type !== 'wholesale' && wrapLineCount(s.body, sz.bs + 4, USABLE) > bodyMax) return true;
  return false;
}

export function runQualityChecks(i: QualityInput): QualityReport {
  const { project: p, scenes } = i;
  const lang = p.language as Lang;
  const L = labelsFor(lang);
  const out: QualityCheck[] = [];
  const add = (id: QualityCheckId, status: CheckStatus, extra: Partial<QualityCheck> = {}) => out.push({ id, status, ...extra });
  const prod = p.video_type === 'product_showcase' || p.video_type === 'wholesale_offer';
  const pr = i.product ?? null;
  const type = p.video_type as VideoType;

  add('scene_count', scenes.length >= 3 ? 'pass' : 'fail', { detail: String(scenes.length) });

  const total = scenes.reduce((a, s) => a + s.duration_ms, 0);
  add('time_total', Math.abs(total - p.duration_seconds * 1000) <= 500 ? 'pass' : 'fail', { detail: `${total / 1000} s / ${p.duration_seconds} s` });

  const shortScenes = scenes.filter((s) => s.duration_ms < 1500).map((s) => s.position);
  add('scene_length', shortScenes.length ? 'warn' : 'pass', shortScenes.length ? { scenes: shortScenes } : {});

  const cut = scenes.filter((s) => textCut(s, p.style)).map((s) => s.position);
  add('text_fit', cut.length ? 'warn' : 'pass', cut.length ? { scenes: cut } : {});

  const lastCta = scenes.find((s) => s.scene_type === 'cta');
  add('cta', p.cta_value.trim() !== '' && !!lastCta && !!(lastCta.headline ?? '').trim() ? 'pass' : 'fail');

  if (prod) {
    add('subject_ready', pr && pr.active && pr.image_approved && pr.image_path ? 'pass' : 'fail');
  } else if (type === 'supplier_spotlight') {
    add('subject_ready', i.supplier && i.supplier.active ? 'pass' : 'fail');
  } else {
    add('subject_ready', i.campaign && i.campaign.active ? 'pass' : 'fail');
  }

  const badImg = scenes.filter((s) => s.image_path && !IMAGE_FOLDERS.includes(s.image_path.split('/')[0] ?? '')).map((s) => s.position);
  add('image_folders', badImg.length ? 'fail' : 'pass', badImg.length ? { scenes: badImg } : {});

  if (type === 'wholesale_offer') {
    add('wholesale_moq', pr && pr.min_order_quantity != null ? 'pass' : 'fail');
    const priced = scenes.filter((s) => /ETB|ብር/.test(`${s.headline ?? ''} ${s.body ?? ''}`)).map((s) => s.position);
    add('wholesale_no_price', priced.length ? 'fail' : 'pass', priced.length ? { scenes: priced } : {});
    const wh = scenes.find((s) => s.scene_type === 'wholesale');
    add('moq_current', !pr || !wh || (pr.min_order_quantity != null && (wh.headline ?? '').includes(String(pr.min_order_quantity))) ? 'pass' : 'warn',
      wh ? { scenes: [wh.position] } : {});
  } else if (prod && pr) {
    const price = pr.sale_price ?? pr.retail_price;
    const priceScenes = scenes.filter((s) => s.scene_type === 'price');
    const stale = priceScenes.filter((s) => price == null || (s.headline ?? '') !== formatPrice(Number(price), lang)).map((s) => s.position);
    add('price_current', stale.length ? 'fail' : 'pass', stale.length ? { scenes: stale } : {});
  }

  if (prod && pr) {
    const claimed = scenes.filter((s) => `${s.headline ?? ''} ${s.body ?? ''}`.includes(L.inStock)).map((s) => s.position);
    add('stock_claim', claimed.length && pr.stock_status !== 'in_stock' ? 'fail' : 'pass', claimed.length ? { scenes: claimed } : {});
  }

  if (type === 'supplier_spotlight') add('consent', i.consented ? 'pass' : 'fail');

  const cap = (p.caption ?? '').trim();
  const tags = p.hashtags ?? [];
  add('caption_limits', cap.length <= 2200 && tags.length <= 30 && tags.every((t) => /^[\p{L}\p{N}_]{1,60}$/u.test(t)) ? 'pass' : 'fail');
  add('caption_present', cap ? 'pass' : 'warn');

  // Claims: text must restate approved data. Words a person typed are warned about; suggested (rules / AI) text that fails is a failure.
  const facts = factsText(buildFacts({
    type, language: lang, cta: { type: p.cta_type as CtaType, value: p.cta_value }, product: prod ? pr : null,
    supplier: type === 'supplier_spotlight' ? (i.supplier ?? null) : null, campaign: type === 'campaign_promotion' ? (i.campaign ?? null) : null,
  }));
  const typedBad: number[] = []; const aiBad: number[] = [];
  for (const s of scenes) {
    for (const f of ['headline', 'body'] as const) {
      const text = s[f];
      if (!text || claimsProblem(text, facts) === null) continue;
      const src = s.source?.[f] ?? '';
      (src === 'rules' || src === 'local_ai' ? aiBad : typedBad).push(s.position);
    }
  }
  const capProblem = cap ? claimsProblem(cap, facts) : null;
  const tagProblem = tags.some((t) => claimsProblem(t, facts) !== null);
  if (aiBad.length) add('claims', 'fail', { scenes: [...new Set(aiBad)] });
  else if (typedBad.length || capProblem || tagProblem) add('claims', 'warn', { scenes: [...new Set(typedBad)] });
  else add('claims', 'pass');

  add('draft_language', lang === 'en' ? 'pass' : 'warn');

  if (p.template_id) add('template_fit', isTemplateId(p.template_id) && templateFits(p.template_id, type, p.duration_seconds as 15 | 20 | 30) ? 'pass' : 'warn');

  const status: CheckStatus = out.some((c) => c.status === 'fail') ? 'fail' : out.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { status, checks: out };
}

