// Entry point:  node src/main.js [--once | --check]
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from './config.js';
import { run } from './ffmpeg.js';
import { processJob } from './worker.js';
import { checkOllama, processCopyJob } from './copyjob.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const log = (m) => console.log(`${new Date().toISOString().replace('T', ' ').slice(0, 19)}  ${m}`);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

const loaded = loadConfig(join(ROOT, '.env'));
if (!loaded.ok) {
  console.error('Cannot start:\n - ' + loaded.errors.join('\n - '));
  process.exit(1);
}
const cfg = loaded.config;
if (cfg.logo) cfg.logo = resolve(ROOT, cfg.logo);
if (cfg.audio) cfg.audio.file = resolve(ROOT, cfg.audio.file);

async function checkTools() {
  for (const [name, bin] of [['FFmpeg', cfg.ffmpeg], ['ffprobe', cfg.ffprobe]]) {
    const { out } = await run(bin, ['-version'], { timeoutMs: 15000 });
    log(`${name}: ${out.split(/\r?\n/)[0]}`);
  }
  const filters = (await run(cfg.ffmpeg, ['-hide_banner', '-filters'], { timeoutMs: 15000 })).out;
  const missing = ['xfade', 'zoompan', 'drawtext', 'gblur', 'unsharp', 'vignette', 'blackdetect'].filter((n) => !new RegExp(`\\s${n}\\s`).test(filters));
  if (missing.length) throw new Error(`This FFmpeg is missing needed filters: ${missing.join(', ')}. Install the "essentials" build from gyan.dev (see the install guide).`);
  log(`Video quality: ${cfg.quality === 'fast' ? 'fast' : 'high'} (set RENDER_QUALITY=fast in .env for quicker renders)`);
  for (const f of ['DejaVuSans-Bold.ttf', 'NotoSansEthiopic-Bold.ttf']) {
    if (!existsSync(join(ROOT, 'fonts', f))) throw new Error(`Font missing: fonts/${f}`);
  }
  log(existsSync(join(ROOT, 'fonts', 'BricolageGrotesque-Bold.ttf')) ? 'Brand font: Bricolage Grotesque' : 'Brand font missing: using the plain fallback font');
  for (const [label, file, wantAudio] of [['Logo', cfg.logo, false], ['Sound', cfg.audio?.file, true]]) {
    if (!file) { log(`${label}: not set (optional)`); continue; }
    if (!existsSync(file)) throw new Error(`${label} file not found: ${file}`);
    const { out } = await run(cfg.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', file], { timeoutMs: 20000 });
    const kinds = (JSON.parse(out).streams ?? []).map((s) => s.codec_type);
    if (!kinds.includes(wantAudio ? 'audio' : 'video')) throw new Error(`${label} file is not a usable ${wantAudio ? 'sound' : 'picture'} file: ${file}`);
    log(`${label}: ${file}`);
  }
}

async function main() {
  await checkTools();
  const client = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: true } });
  const { error } = await client.auth.signInWithPassword({ email: cfg.email, password: cfg.password });
  if (error) throw new Error(`Renderer sign-in failed: ${error.message}`);
  log('Signed in as the renderer account.');
  log(cfg.ai ? await checkOllama(cfg.ai) : 'Local AI: off (optional). Set OLLAMA_MODEL in .env to turn it on.');
  if (args.has('--check')) { log('Check passed. FFmpeg, fonts and sign-in all work.'); return; }

  let stop = false;
  process.on('SIGINT', () => { stop = true; log('Stopping after the current job…'); });
  let failures = 0;
  let aiOn = !!cfg.ai;
  while (!stop) {
    const { data, error: e } = await client.rpc('renderer_claim_job');
    if (e) {
      failures++;
      log(e.message === 'Not allowed' ? 'This login is not registered as a renderer. Ask the owner to add it (see the install guide).' : `Could not check for jobs: ${e.message}`);
      if (e.message === 'Not allowed') process.exit(1);
      await sleep(Math.min(300, cfg.pollSeconds * failures));
      continue;
    }
    failures = 0;
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) {
      if (aiOn) {
        const c = await client.rpc('copy_claim_job');
        if (c.error) {
          log(/copy_claim_job|schema cache/i.test(c.error.message) ? 'AI wording needs database migration 0006. Turning the local AI off for this run.' : `Could not check for AI requests: ${c.error.message}`);
          aiOn = false;
        } else {
          const cj = Array.isArray(c.data) ? c.data[0] : c.data;
          if (cj) { await processCopyJob({ client, job: cj, cfg, log }); if (args.has('--once')) return; continue; }
        }
      }
      if (args.has('--once')) { log('No queued videos.'); return; }
      await sleep(cfg.pollSeconds); continue;
    }
    await processJob({ client, job, cfg, log });
    if (args.has('--once')) return;
  }
}

main().catch((e) => { console.error(`Renderer stopped: ${e.message}`); process.exit(1); });
