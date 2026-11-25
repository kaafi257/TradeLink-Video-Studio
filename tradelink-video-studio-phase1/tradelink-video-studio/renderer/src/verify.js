// ffprobe summary and the format check. The database repeats the same check, so a bad file can never become "Ready to post".
export function summarizeProbe(probe) {
  const streams = probe?.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  if (!v) return null;
  const [num, den] = String(v.r_frame_rate ?? '0/1').split('/').map(Number);
  const fps = den ? Math.round((num / den) * 1000) / 1000 : 0;
  const dur = Number(probe?.format?.duration ?? v.duration ?? NaN);
  return {
    width: Number(v.width), height: Number(v.height), codec: v.codec_name, pix_fmt: v.pix_fmt, fps,
    duration_s: Math.round(dur * 1000) / 1000, has_audio: !!a, audio_codec: a ? a.codec_name : null,
    size_bytes: Number(probe?.format?.size ?? 0) || null,
  };
}

/** Reads ffmpeg blackdetect output: [{start, end, duration}] in seconds. */
export function parseBlackDetect(stderr) {
  const out = [];
  for (const m of String(stderr ?? '').matchAll(/black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g)) {
    out.push({ start: Number(m[1]), end: Number(m[2]), duration: Number(m[3]) });
  }
  return out;
}

/**
 * After-render picture notes. These are WARNINGS for the person who reviews the video, not failures: a legitimately dark
 * product photo must not block a good video. Returns null when nothing stands out.
 */
export function pictureNotes({ videoBlack = [], coverBlack = [] }) {
  if (!videoBlack.length && !coverBlack.length) return null;
  const notes = {};
  if (videoBlack.length) {
    const w = videoBlack.reduce((a, b) => (b.duration > a.duration ? b : a));
    notes.dark_seconds = Math.round(w.duration * 10) / 10;
    notes.dark_start = Math.round(w.start * 10) / 10;
  }
  if (coverBlack.length) notes.cover_dark = true;
  return notes;
}

/** Returns a list of problems (empty = OK). */
export function checkSummary(s, expectedMs) {
  if (!s) return ['no video stream found'];
  const p = [];
  if (s.width !== 1080 || s.height !== 1920) p.push(`size is ${s.width}x${s.height}, must be 1080x1920`);
  if (s.codec !== 'h264') p.push(`codec is ${s.codec}, must be h264`);
  if (s.pix_fmt !== 'yuv420p') p.push(`pixel format is ${s.pix_fmt}, must be yuv420p`);
  if (!(s.fps >= 29.97 && s.fps <= 30.03)) p.push(`frame rate is ${s.fps}, must be 30`);
  if (!Number.isFinite(s.duration_s) || Math.abs(s.duration_s * 1000 - expectedMs) > 600) p.push(`length is ${s.duration_s}s, expected ${expectedMs / 1000}s`);
  if (s.has_audio && s.audio_codec !== 'aac') p.push(`audio is ${s.audio_codec}, must be aac`);
  return p;
}
