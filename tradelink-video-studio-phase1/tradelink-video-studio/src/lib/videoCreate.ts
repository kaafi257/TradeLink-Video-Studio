// Shared by the full wizard and Quick create, so there is ONE way to build and save a draft video.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Campaign, Product, Supplier } from './catalogue';
import { buildFacts, rulesProvider, runCopy } from './copy';
import { generateScenes, type Cta, type Duration, type Lang, type PlanResult, type Scene, type Style, type VideoType } from './scenes';
import type { TemplateId } from './templates';

export interface PlanArgs {
  type: VideoType; language: Lang; duration: Duration; style: Style; cta: Cta; templateId?: TemplateId | null;
  subject: Product | Supplier | Campaign | null;
  consented: boolean;
  campaignProducts: Product[];
}

export function buildPlan(a: PlanArgs): PlanResult {
  const prod = a.type === 'product_showcase' || a.type === 'wholesale_offer';
  return generateScenes({
    type: a.type, language: a.language, duration: a.duration, style: a.style, cta: a.cta, templateId: a.templateId ?? null,
    product: prod ? (a.subject as Product | null) : null,
    supplier: a.type === 'supplier_spotlight' ? (a.subject as Supplier | null) : null,
    campaign: a.type === 'campaign_promotion' ? (a.subject as Campaign | null) : null,
    supplierConsent: a.consented,
    campaignProducts: a.type === 'campaign_promotion' ? a.campaignProducts : [],
  });
}

/** Caption and hashtags from approved facts, through the claims guard. Empty when nothing passes. */
export async function draftCopy(a: PlanArgs, scenes: Scene[]): Promise<{ caption?: string; hashtags: string[]; dropped: string[] }> {
  const prod = a.type === 'product_showcase' || a.type === 'wholesale_offer';
  const facts = buildFacts({
    type: a.type, language: a.language, cta: a.cta,
    product: prod ? (a.subject as Product | null) : null,
    supplier: a.type === 'supplier_spotlight' ? (a.subject as Supplier | null) : null,
    campaign: a.type === 'campaign_promotion' ? (a.subject as Campaign | null) : null,
  });
  const r = await runCopy(rulesProvider, {
    facts, scope: 'caption',
    scenes: scenes.map((s) => ({ position: s.position, scene_type: s.scene_type, headline: s.headline, body: s.body })),
  });
  if (!r.ok) return { hashtags: [], dropped: [r.error] };
  return { caption: r.result.caption, hashtags: r.result.hashtags ?? [], dropped: r.dropped };
}

export interface SaveArgs extends PlanArgs {
  title: string; subjectId: string; scenes: Scene[];
  copy?: { caption?: string; hashtags: string[] };
}

/** Saves a DRAFT project and its scenes. If the scenes fail, the project is removed so no half-made video is left. */
export async function saveVideoDraft(supabase: SupabaseClient, a: SaveArgs): Promise<string | null> {
  const prod = a.type === 'product_showcase' || a.type === 'wholesale_offer';
  const hasCopy = !!a.copy && (!!a.copy.caption || a.copy.hashtags.length > 0);
  const { data, error } = await supabase.from('video_projects').insert({
    title: a.title.slice(0, 160), video_type: a.type,
    product_id: prod ? a.subjectId : null,
    supplier_id: a.type === 'supplier_spotlight' ? a.subjectId : null,
    campaign_id: a.type === 'campaign_promotion' ? a.subjectId : null,
    language: a.language, duration_seconds: a.duration, style: a.style, cta_type: a.cta.type, cta_value: a.cta.value.trim(),
    ...(a.templateId ? { template_id: a.templateId } : {}),
    ...(hasCopy ? { caption: a.copy?.caption ?? null, hashtags: a.copy?.hashtags ?? [], copy_source: 'rules' } : {}),
  }).select('id').single();
  if (error || !data) return null;
  const id = (data as { id: string }).id;
  const { error: e2 } = await supabase.from('video_scenes').insert(a.scenes.map((s) => ({ ...s, project_id: id })));
  if (e2) {
    await supabase.from('video_projects').delete().eq('id', id);
    return null;
  }
  return id;
}
