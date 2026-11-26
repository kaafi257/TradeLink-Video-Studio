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
  // Optional local AI (Ollama). Off unless OLLAMA_MODEL is set. It may only talk to THIS computer.
  const model = (env.OLLAMA_MODEL ?? '').trim();
  const aiUrl = (env.OLLAMA_URL ?? 'http://127.0.0.1:11434').trim().replace(/\/$/, '');
  const aiTimeout = Number(env.OLLAMA_TIMEOUT_SECONDS ?? 120);
  if (model) {
    if (!/^[A-Za-z0-9._:/-]{1,80}$/.test(model)) errors.push('OLLAMA_MODEL has unexpected characters');
    if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(aiUrl)) errors.push('OLLAMA_URL must be http://127.0.0.1:<port> or http://localhost:<port>. The local AI must stay on this computer');
    if (!Number.isFinite(aiTimeout) || aiTimeout < 10 || aiTimeout > 600) errors.push('OLLAMA_TIMEOUT_SECONDS must be between 10 and 600');
  }
  // Optional brand logo and background sound: files YOU put on this computer. Nothing is downloaded or chosen for you.
  const logo = (env.BRAND_LOGO ?? '').trim();
  const audio = (env.AUDIO_FILE ?? '').trim();
  const volume = Number(env.AUDIO_VOLUME ?? 0.5);
  if (logo && !/\.(png|jpe?g|webp)$/i.test(logo)) errors.push('BRAND_LOGO must be a .png, .jpg or .webp file');
  if (audio && !/\.(mp3|m4a|aac|wav|ogg)$/i.test(audio)) errors.push('AUDIO_FILE must be a .mp3, .m4a, .aac, .wav or .ogg file');
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) errors.push('AUDIO_VOLUME must be between 0 and 1');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    config: {
      url: url.replace(/\/$/, ''), key, email, password,
      ffmpeg: (env.FFMPEG_PATH ?? 'ffmpeg').trim() || 'ffmpeg',
      ffprobe: (env.FFPROBE_PATH ?? 'ffprobe').trim() || 'ffprobe',
      pollSeconds: poll,
      logo: logo || null,
      audio: audio ? { file: audio, volume } : null,
      ai: model ? { url: aiUrl, model, timeoutSeconds: aiTimeout } : null,
    },
  };
}

export function loadConfig(path) {
  if (!existsSync(path)) return { ok: false, errors: [`Settings file not found: ${path}. Copy .env.example to .env and fill it in.`] };
  return validateConfig(parseEnv(readFileSync(path, 'utf8')));
}
