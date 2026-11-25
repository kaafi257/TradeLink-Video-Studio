// Pure video rules for the screens (no network). The database enforces the same rules; these only drive the UI.
import type { Scene } from './scenes';

export const VIDEO_STATUSES = ['draft', 'queued', 'rendering', 'failed', 'ready_to_post', 'published_manually', 'archived'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export interface VideoProject {
  id: string; title: string; video_type: string; product_id: string | null; supplier_id: string | null; campaign_id: string | null;
  language: 'en' | 'am' | 'so'; duration_seconds: 15 | 20 | 30; style: string; cta_type: string; cta_value: string;
  caption: string | null; hashtags: string[]; suggested_post_time: string | null;
  template_id: string | null; copy_source: 'manual' | 'rules' | 'local_ai'; quality_report: { status: 'pass' | 'warn' | 'fail'; checks: unknown[] } | null; quality_checked_at: string | null;
  status: VideoStatus; status_note: string | null; published_at: string | null; created_at: string; updated_at: string;
}
export interface VideoSceneRow extends Omit<Scene, 'source'> { id: string; project_id: string; source: Record<string, string> }
export interface RenderJob { id: string; project_id: string; status: string; attempt: number; error_message: string | null; output_path: string | null; cover_path: string | null; probe: Record<string, unknown> | null; created_at: string }
export interface StatusHistoryRow { id: number; from_status: string | null; to_status: string; at: string; note: string | null }

export type VideoAction = 'queue' | 'cancel' | 'archive' | 'backToDraft' | 'markPublished';

/** Scenes and details can be edited only in these states. */
export function isEditable(status: VideoStatus): boolean {
  return status === 'draft' || status === 'failed';
}

/** What an owner or editor may do next. Viewers get nothing. Rendering and Ready are controlled by the renderer. */
export function availableActions(status: VideoStatus, canWrite: boolean): VideoAction[] {
  if (!canWrite) return [];
  switch (status) {
    case 'draft': return ['queue', 'archive'];
    case 'queued': return ['cancel'];
    case 'rendering': return [];
    case 'failed': return ['queue', 'backToDraft', 'archive'];
    case 'ready_to_post': return ['markPublished', 'archive'];
    case 'published_manually': return ['archive'];
    case 'archived': return ['backToDraft'];
  }
}

export function sceneTotalMs(scenes: Array<{ duration_ms: number }>): number {
  return scenes.reduce((a, s) => a + s.duration_ms, 0);
}
/** Same tolerance as the database (500 ms). */
export function timeMatches(totalMs: number, seconds: number): boolean {
  return Math.abs(totalMs - seconds * 1000) <= 500;
}

/** Whole or one-decimal seconds typed by the editor -> milliseconds (1000-15000), or null if invalid. */
export function parseSeconds(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,2}(\.\d)?$/.test(s)) return null;
  const ms = Math.round(Number(s) * 1000);
  return ms >= 1000 && ms <= 15000 ? ms : null;
}

/** Hashtags are typed by the owner only; nothing is suggested. Returns clean tags without '#', or 'invalid'. */
export function parseHashtags(raw: string): string[] | 'invalid' {
  const parts = raw.split(/[\s,]+/).map((p) => p.replace(/^#+/, '')).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (!/^[\p{L}\p{N}_]{1,60}$/u.test(p)) return 'invalid';
    if (!out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  return out.length <= 30 ? out : 'invalid';
}
export function formatHashtags(tags: string[]): string {
  return tags.map((t) => `#${t}`).join(' ');
}

/** The text to copy into TikTok: the caption followed by the hashtags. */
export function postText(caption: string | null, tags: string[]): string {
  return [caption?.trim() ?? '', formatHashtags(tags)].filter(Boolean).join('\n\n');
}

/** A short, honest description of the verified file, from the renderer's ffprobe report. Null if the report is missing. */
export function describeFile(probe: Record<string, unknown> | null): string | null {
  if (!probe) return null;
  const w = Number(probe.width), h = Number(probe.height), fps = Number(probe.fps), dur = Number(probe.duration_s);
  if (![w, h, fps, dur].every(Number.isFinite)) return null;
  const size = Number(probe.size_bytes);
  const parts = [`${w}×${h}`, `${Math.round(fps)} fps`, `${dur.toFixed(1)} s`, probe.has_audio ? 'with sound' : 'no sound'];
  if (Number.isFinite(size) && size > 0) parts.push(`${(size / 1048576).toFixed(1)} MB`);
  return parts.join(' · ');
}
