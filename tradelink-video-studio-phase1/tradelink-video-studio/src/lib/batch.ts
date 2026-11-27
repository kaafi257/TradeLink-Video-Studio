// Batch create (Phase 5, Stage B): one draft video per ticked product, built exactly like Quick create.
// Every video is a DRAFT unless "check and queue" was chosen; nothing is published. Products that cannot make a
// proper video (too little approved data) are skipped and listed with the reason, never padded with invented text.
import type { Product } from './catalogue';
import type { Cta, Duration, Lang, Style, VideoType } from './scenes';
import type { TemplateId } from './templates';
import { buildPlan, draftCopy, type SaveArgs } from './videoCreate';
import type { QueueOutcome } from './videoCheck';

export const BATCH_MAX = 25;
export const MIN_SCENES = 3;

export type BatchStatus = 'queued' | 'draft' | 'skipped' | 'error';
export interface BatchOutcome { productId: string; name: string; status: BatchStatus; reasonKey?: string; videoId?: string }
export interface BatchDeps {
  save: (a: SaveArgs) => Promise<string | null>;
  finish: (videoId: string) => Promise<QueueOutcome>;
}
export interface BatchOptions {
  products: Product[]; type: VideoType; language: Lang; duration: Duration; style: Style; cta: Cta; templateId: TemplateId;
  title: (p: Product) => string; andQueue: boolean; deps: BatchDeps; onProgress?: (done: number, total: number) => void;
}

export async function runBatch(o: BatchOptions): Promise<BatchOutcome[]> {
  const list = o.products.slice(0, BATCH_MAX);
  const out: BatchOutcome[] = [];
  for (const [i, p] of list.entries()) {
    const base = { productId: p.id, name: p.name };
    try {
      const args = { type: o.type, language: o.language, duration: o.duration, style: o.style, cta: o.cta, templateId: o.templateId, subject: p, consented: false, campaignProducts: [] };
      const plan = buildPlan(args);
      if (!plan.ok) out.push({ ...base, status: 'skipped', reasonKey: `vid.problem.${plan.problem}` });
      else if (plan.scenes.length < MIN_SCENES) out.push({ ...base, status: 'skipped', reasonKey: 'batch.tooFew' });
      else {
        const copy = await draftCopy(args, plan.scenes);
        const id = await o.deps.save({ ...args, title: o.title(p), subjectId: p.id, scenes: plan.scenes, copy });
        if (!id) out.push({ ...base, status: 'error', reasonKey: 'common.saveError' });
        else if (!o.andQueue) out.push({ ...base, status: 'draft', videoId: id });
        else {
          const r = await o.deps.finish(id);
          out.push(r.kind === 'queued' ? { ...base, status: 'queued', videoId: id }
            : { ...base, status: 'draft', videoId: id, reasonKey: r.kind === 'blocked' ? 'batch.blocked' : 'batch.queueError' });
        }
      }
    } catch {
      out.push({ ...base, status: 'error', reasonKey: 'common.saveError' });
    }
    o.onProgress?.(i + 1, list.length);
  }
  return out;
}
