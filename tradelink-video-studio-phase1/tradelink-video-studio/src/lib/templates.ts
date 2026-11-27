// The nine video templates (six from Phase 4, three added in Phase 5). A template sets pacing (scene weights), animations and the layout style.
// It never adds text or claims: scene text still comes only from approved catalogue data (see scenes.ts).
import type { Animation, Duration, SceneType, Style, VideoType } from './scenes';

export const TEMPLATE_IDS = ['clean_product', 'bold_sale', 'wholesale_offer', 'supplier_spotlight', 'campaign_banner', 'story_quick', 'minimal_product', 'wholesale_bold', 'campaign_minimal'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface Template {
  id: TemplateId;
  videoTypes: VideoType[];
  style: Style;
  durations: Duration[];
  defaultDuration: Duration;
  /** Pacing weights per scene type. A scene type not listed keeps the generator's default weight. */
  weights: Partial<Record<SceneType, number>>;
  animations: { image: Animation[]; text: Animation };
}

export const TEMPLATES: Record<TemplateId, Template> = {
  clean_product: {
    id: 'clean_product', videoTypes: ['product_showcase'], style: 'premium', durations: [15, 20, 30], defaultDuration: 20,
    weights: {}, animations: { image: ['zoom_in', 'zoom_out'], text: 'fade' },
  },
  bold_sale: {
    id: 'bold_sale', videoTypes: ['product_showcase'], style: 'dynamic', durations: [15, 20, 30], defaultDuration: 15,
    weights: { intro: 2, price: 5, product: 3, cta: 3 }, animations: { image: ['pan_left', 'zoom_in', 'pan_right'], text: 'slide_up' },
  },
  wholesale_offer: {
    id: 'wholesale_offer', videoTypes: ['wholesale_offer'], style: 'premium', durations: [15, 20, 30], defaultDuration: 20,
    weights: { wholesale: 5 }, animations: { image: ['zoom_in', 'fade'], text: 'fade' },
  },
  supplier_spotlight: {
    id: 'supplier_spotlight', videoTypes: ['supplier_spotlight'], style: 'premium', durations: [20, 30], defaultDuration: 20,
    weights: { supplier: 5 }, animations: { image: ['zoom_out', 'fade'], text: 'fade' },
  },
  campaign_banner: {
    id: 'campaign_banner', videoTypes: ['campaign_promotion'], style: 'dynamic', durations: [15, 20, 30], defaultDuration: 20,
    weights: { campaign: 4 }, animations: { image: ['pan_right', 'pan_left', 'zoom_in'], text: 'slide_up' },
  },
  story_quick: {
    id: 'story_quick', videoTypes: ['product_showcase', 'wholesale_offer'], style: 'dynamic', durations: [15], defaultDuration: 15,
    weights: { intro: 2, product: 3, price: 3, wholesale: 3, cta: 2 }, animations: { image: ['zoom_in', 'pan_left'], text: 'slide_up' },
  },
  minimal_product: {
    id: 'minimal_product', videoTypes: ['product_showcase'], style: 'minimal', durations: [15, 20, 30], defaultDuration: 20,
    weights: {}, animations: { image: ['fade'], text: 'none' },
  },
  wholesale_bold: {
    id: 'wholesale_bold', videoTypes: ['wholesale_offer'], style: 'dynamic', durations: [15, 20, 30], defaultDuration: 15,
    weights: { wholesale: 5, cta: 3 }, animations: { image: ['pan_left', 'zoom_in'], text: 'slide_up' },
  },
  campaign_minimal: {
    id: 'campaign_minimal', videoTypes: ['campaign_promotion'], style: 'minimal', durations: [15, 20, 30], defaultDuration: 20,
    weights: { campaign: 4 }, animations: { image: ['fade'], text: 'none' },
  },
};

export function isTemplateId(v: string | null | undefined): v is TemplateId {
  return !!v && (TEMPLATE_IDS as readonly string[]).includes(v);
}

export function templateFits(id: TemplateId, type: VideoType, duration: Duration): boolean {
  const t = TEMPLATES[id];
  return t.videoTypes.includes(type) && t.durations.includes(duration);
}

/** Templates that suit a video type, in display order. */
export function templatesFor(type: VideoType): Template[] {
  return TEMPLATE_IDS.map((id) => TEMPLATES[id]).filter((t) => t.videoTypes.includes(type));
}
