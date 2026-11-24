// Entry point:  node src/main.js [--once | --check]
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from './config.js';
import { run } from './ffmpeg.js';
import { processJob } from './worker.js';

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

async function checkTools() {
  for (const [name, bin] of [['FFmpeg', cfg.ffmpeg], ['ffprobe', cfg.ffprobe]]) {
    const { out } = await run(bin, ['-version'], { timeoutMs: 15000 });
    log(`${name}: ${out.split(/\r?\n/)[0]}`);
  }
  for (const f of ['DejaVuSans-Bold.ttf', 'NotoSansEthiopic-Bold.ttf']) {
    if (!existsSync(join(ROOT, 'fonts', f))) throw new Error(`Font missing: fonts/${f}`);
  }
}

async function main() {
  await checkTools();
  const client = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: true } });
  const { error } = await client.auth.signInWithPassword({ email: cfg.email, password: cfg.password });
  if (error) throw new Error(`Renderer sign-in failed: ${error.message}`);
  log('Signed in as the renderer account.');
  if (args.has('--check')) { log('Check passed. FFmpeg, fonts and sign-in all work.'); return; }

  let stop = false;
  process.on('SIGINT', () => { stop = true; log('Stopping after the current job…'); });
  let failures = 0;
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
    if (!job) { if (args.has('--once')) { log('No queued videos.'); return; } await sleep(cfg.pollSeconds); continue; }
    await processJob({ client, job, cfg, log });
    if (args.has('--once')) return;
  }
}

main().catch((e) => { console.error(`Renderer stopped: ${e.message}`); process.exit(1); });
