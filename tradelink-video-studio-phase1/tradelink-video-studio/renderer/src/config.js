// Reads renderer/.env and refuses unsafe settings. The renderer must only ever hold a PUBLISHABLE key and its own login.
import { readFileSync, existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

function jwtRole(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(part, 'base64').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

/** Returns { ok: true, config } or { ok: false, errors: string[] }. Never echoes secret values. */
export function validateConfig(env) {
  const errors = [];
  const url = (env.STUDIO_SUPABASE_URL ?? '').trim();
  const key = (env.STUDIO_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  const email = (env.RENDERER_EMAIL ?? '').trim();
  const password = env.RENDERER_PASSWORD ?? '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) errors.push('STUDIO_SUPABASE_URL must look like https://<project>.supabase.co');
  if (!key) errors.push('STUDIO_SUPABASE_PUBLISHABLE_KEY is missing');
  else if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') {
    errors.push('STUDIO_SUPABASE_PUBLISHABLE_KEY holds a secret/service-role key. Refusing to start: use the publishable (anon) key only');
  }
  if (!email) errors.push('RENDERER_EMAIL is missing');
  if (!password) errors.push('RENDERER_PASSWORD is missing');
  const poll = Number(env.POLL_SECONDS ?? 15);
  if (!Number.isFinite(poll) || poll < 5 || poll > 3600) errors.push('POLL_SECONDS must be between 5 and 3600');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    config: {
      url: url.replace(/\/$/, ''), key, email, password,
      ffmpeg: (env.FFMPEG_PATH ?? 'ffmpeg').trim() || 'ffmpeg',
      ffprobe: (env.FFPROBE_PATH ?? 'ffprobe').trim() || 'ffprobe',
      pollSeconds: poll,
    },
  };
}

export function loadConfig(path) {
  if (!existsSync(path)) return { ok: false, errors: [`Settings file not found: ${path}. Copy .env.example to .env and fill it in.`] };
  return validateConfig(parseEnv(readFileSync(path, 'utf8')));
}
