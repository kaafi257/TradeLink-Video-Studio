// Shared by the editor and "Create, check and queue": load the subject, run the quality check, save the report,
// automatically fix the safe problems, and queue. Nothing here invents text: fixes only re-take wording the scene
// generator builds from approved catalogue data.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Campaign, Product, Supplier } from './catalogue';
import { buildPlan, draftCopy } from './videoCreate';
import { runQualityChecks, type QualityInput, type QualityReport } from './quality';
import type { Duration, Lang, Style, VideoType } from './scenes';
import { isTemplateId } from './templates';
import type { VideoProject, VideoSceneRow } from './videos';

export interface Subject { product: Product | null; supplier: Supplier | null; campaign: Campaign | null; consented: boolean; campaignProducts: Product[] }

const isProd = (v: Pick<VideoProject, 'video_type'>) => v.video_type === 'product_showcase' || v.video_type === 'wholesale_offer';

/** The current catalogue rows a video was made from. Null if any read fails. */
export async function loadSubject(db: SupabaseClient, v: VideoProject): Promise<Subject | null> {
  const [pr, su, ca, co, cp] = await Promise.all([
    isProd(v) && v.product_id ? db.from('products').select('*').eq('id', v.product_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    v.supplier_id ? db.from('suppliers').select('*').eq('id', v.supplier_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    v.campaign_id ? db.from('campaigns').select('*').eq('id', v.campaign_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    v.supplier_id ? db.from('supplier_consents').select('withdrawn').eq('supplier_id', v.supplier_id) : Promise.resolve({ data: [], error: null }),
    v.campaign_id ? db.from('campaign_products').select('product_id').eq('campaign_id', v.campaign_id) : Promise.resolve({ data: [], error: null }),
  ]);
  if (pr.error || su.error || ca.error || co.error || cp.error) return null;
  let campaignProducts: Product[] = [];
  const ids = ((cp.data ?? []) as Array<{ product_id: string }>).map((x) => x.product_id);
  if (ids.length) {
    const { data, error } = await db.from('products').select('*').in('id', ids);
    if (error) return null;
    campaignProducts = (data ?? []) as Product[];
  }
  return {
    product: (pr.data as Product | null) ?? null, supplier: (su.data as Supplier | null) ?? null, campaign: (ca.data as Campaign | null) ?? null,
    consented: ((co.data ?? []) as Array<{ withdrawn: boolean }>).some((c) => !c.withdrawn), campaignProducts,
  };
}

export function qualityInput(v: VideoProject, scenes: VideoSceneRow[], s: Subject): QualityInput {
  return { project: v, scenes, product: s.product, supplier: s.supplier, campaign: s.campaign, consented: s.consented };
}

/** Runs the check on the SAVED draft and stores the report. Null when it could not be saved. */
export async function checkAndSave(db: SupabaseClient, v: VideoProject, scenes: VideoSceneRow[], s: Subject): Promise<QualityReport | null> {
  const report = runQualityChecks(qualityInput(v, scenes, s));
  const { error } = await db.rpc('save_quality_report', { p_project: v.id, p_report: report });
  return error ? null : report;
}

/** Scene positions that the automatic fix may re-take from approved data, and whether the caption may be written. */
export function fixTargets(report: QualityReport): { positions: Set<number>; caption: boolean; any: boolean } {
  const positions = new Set<number>();
  let caption = false;
  for (const c of report.checks) {
    if (c.status === 'pass') continue;
    if (['price_current', 'moq_current', 'text_fit', 'claims', 'cta'].includes(c.id)) (c.scenes ?? []).forEach((p) => positions.add(p));
    if (c.id === 'caption_present') caption = true;
  }
  return { positions, caption, any: positions.size > 0 || caption };
}

/** Re-takes the flagged scenes' wording (and an empty caption) from approved data. Timing, pictures and order are never changed. */
export async function autoFix(db: SupabaseClient, v: VideoProject, scenes: VideoSceneRow[], s: Subject, report: QualityReport): Promise<boolean> {
  const targets = fixTargets(report);
  if (!targets.any) return false;
  const subject = isProd(v) ? s.product : v.video_type === 'supplier_spotlight' ? s.supplier : s.campaign;
  const args = {
    type: v.video_type as VideoType, language: v.language as Lang, duration: v.duration_seconds as Duration, style: v.style as Style,
    cta: { type: v.cta_type as never, value: v.cta_value }, templateId: isTemplateId(v.template_id) ? v.template_id : null,
    subject, consented: s.consented, campaignProducts: s.campaignProducts,
  };
  const plan = buildPlan(args);
  if (!plan.ok) return false;
  let changed = false;
  for (const row of scenes) {
    if (!targets.positions.has(row.position)) continue;
    const gen = plan.scenes.find((g) => g.position === row.position && g.scene_type === row.scene_type);
    if (!gen) continue;
    const { error } = await db.from('video_scenes').update({ headline: gen.headline, body: gen.body, source: gen.source }).eq('id', row.id);
    if (error) return changed;
    changed = true;
  }
  if (targets.caption && !(v.caption ?? '').trim()) {
    const copy = await draftCopy(args, plan.scenes);
    if (copy.caption) {
      const { error } = await db.from('video_projects').update({ caption: copy.caption, hashtags: copy.hashtags, copy_source: 'rules' }).eq('id', v.id);
      if (!error) changed = true;
    }
  }
  return changed;
}

export type QueueOutcome = { kind: 'queued' } | { kind: 'blocked'; report: QualityReport } | { kind: 'error' };

async function reload(db: SupabaseClient, id: string): Promise<{ v: VideoProject; scenes: VideoSceneRow[] } | null> {
  const [v, sc] = await Promise.all([
    db.from('video_projects').select('*').eq('id', id).maybeSingle(),
    db.from('video_scenes').select('*').eq('project_id', id).order('position'),
  ]);
  if (v.error || sc.error || !v.data) return null;
  return { v: v.data as VideoProject, scenes: (sc.data ?? []) as VideoSceneRow[] };
}

/** Check -> (fix safe problems once) -> check again -> queue. Stops, still a Draft, when a problem is left. */
export async function checkFixQueue(db: SupabaseClient, id: string): Promise<QueueOutcome> {
  let cur = await reload(db, id);
  if (!cur) return { kind: 'error' };
  const subject = await loadSubject(db, cur.v);
  if (!subject) return { kind: 'error' };
  let report = await checkAndSave(db, cur.v, cur.scenes, subject);
  if (!report) return { kind: 'error' };
  if (report.status === 'fail' && (await autoFix(db, cur.v, cur.scenes, subject, report))) {
    cur = await reload(db, id);
    if (!cur) return { kind: 'error' };
    report = await checkAndSave(db, cur.v, cur.scenes, subject);
    if (!report) return { kind: 'error' };
  }
  if (report.status === 'fail') return { kind: 'blocked', report };
  const { error } = await db.rpc('queue_video', { p_project: id });
  return error ? { kind: 'error' } : { kind: 'queued' };
}
