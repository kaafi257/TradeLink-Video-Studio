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
