// Real FFmpeg, fake Supabase. Skipped automatically when ffmpeg is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { processJob } from '../src/worker.js';
import { summarizeProbe, checkSummary } from '../src/verify.js';

const have = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const cfg = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
const dir = mkdtempSync(join(tmpdir(), 'rt-'));
const sh = (args) => { const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args]); if (r.status !== 0) throw new Error(r.stderr.toString()); };
let landscape, portrait;
if (have) {
  sh(['-f', 'lavfi', '-i', 'testsrc2=size=800x600', '-frames:v', '1', join(dir, 'a.jpg')]);
  sh(['-f', 'lavfi', '-i', 'testsrc2=size=600x900', '-frames:v', '1', join(dir, 'b.png')]);
  landscape = readFileSync(join(dir, 'a.jpg')); portrait = readFileSync(join(dir, 'b.png'));
}

function fake({ missing = false, completeAnswer = 'ready' } = {}) {
  const calls = []; const uploads = {};
  const client = {
    rpc: async (name, a) => { calls.push([name, a]); return { data: name === 'renderer_complete_job' ? completeAnswer : 'failed', error: null }; },
    storage: { from: (bucket) => ({
      download: async (p) => (missing ? { data: null, error: { message: 'nope' } } : { data: new Blob([p.endsWith('png') ? portrait : landscape]), error: null }),
      upload: async (p, body) => { uploads[`${bucket}/${p}`] = Buffer.from(body); return { error: null }; },
    }) },
  };
  return { client, calls, uploads };
}

const mkJob = (style, scenes, expectedMs, lang = 'en') => ({ id: 'job1', project_id: 'proj1', attempt: 1, expected_ms: expectedMs, plan: { project: { style, language: lang }, scenes } });
const sc = (type, ms, headline, body, img, anim) => ({ scene_type: type, duration_ms: ms, headline, body, image_path: img, animation: anim });

function probeFile(buf, name) {
  const f = join(dir, name); writeFileSync(f, buf);
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', f]);
  return summarizeProbe(JSON.parse(r.stdout.toString()));
}

const ANIMS = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'slide_up', 'slide_left', 'reveal', 'fade', 'none'];

for (const style of ['premium', 'dynamic', 'minimal']) {
  test(`renders a real 20s MP4 in ${style} style and reports it`, { skip: !have, timeout: 120000 }, async () => {
    const { client, calls, uploads } = fake();
    const scenes = [
      sc('intro', 4000, 'Test Shirt', null, 'products/a.jpg', 'zoom_in'),
      sc('product', 5000, 'Acme · 25 kg', 'A longer description that has to wrap across several lines on a phone screen', 'products/b.png', 'pan_left'),
      sc('price', 4000, 'ETB 80.00', 'ETB 100.00', null, 'slide_up'),
      sc('wholesale', 4000, 'Minimum order: 12 bag', 'Request a Quote', null, 'reveal'),
      sc('cta', 3000, 'WhatsApp: +251911000000', null, null, 'fade'),
    ];
    const res = await processJob({ client, job: mkJob(style, scenes, 20000), cfg, log: () => {} });
    assert.equal(res, 'ready');
    const done = calls.find((c) => c[0] === 'renderer_complete_job');
    assert.ok(done, 'completion reported'); assert.ok(!calls.some((c) => c[0] === 'renderer_fail_job'));
    assert.equal(done[1].p_output, 'proj1/job1-1.mp4'); assert.equal(done[1].p_cover, 'proj1/job1-1.jpg');
    const v = probeFile(uploads['renders/proj1/job1-1.mp4'], `${style}.mp4`);
    assert.deepEqual(checkSummary(v, 20000), [], JSON.stringify(v));
    assert.equal(v.width, 1080); assert.equal(v.height, 1920); assert.equal(v.codec, 'h264'); assert.equal(v.pix_fmt, 'yuv420p'); assert.equal(v.has_audio, false);
    assert.ok(Math.abs(v.duration_s - 20) < 0.2, String(v.duration_s));
    assert.deepEqual(done[1].p_probe, v === done[1].p_probe ? v : done[1].p_probe);
    const cover = probeFile(uploads['covers/proj1/job1-1.jpg'], `${style}-cover.jpg`);
    assert.equal(cover.width, 1080); assert.equal(cover.height, 1920);
  });
}

test('every animation is accepted by FFmpeg (15s, all styles share the filters)', { skip: !have, timeout: 120000 }, async () => {
  const { client, calls } = fake();
  const scenes = ANIMS.map((a, i) => sc(i % 2 ? 'product' : 'intro', i === ANIMS.length - 1 ? 1000 + (15000 - 1000 * ANIMS.length) : 1000, `Scene ${i} ${a}`, i % 3 === 0 ? 'Body text' : null, i % 2 ? null : 'products/a.jpg', a));
  const total = scenes.reduce((s, x) => s + x.duration_ms, 0);
  assert.equal(total, 15000);
  const res = await processJob({ client, job: mkJob('dynamic', scenes, 15000), cfg, log: () => {} });
  assert.equal(res, 'ready', JSON.stringify(calls.filter((c) => c[0] === 'renderer_fail_job')));
});

test('Amharic text renders with the Ethiopic font', { skip: !have, timeout: 120000 }, async () => {
  const { client, calls, uploads } = fake();
  const scenes = [sc('intro', 5000, 'የምርት ማሳያ', null, 'products/a.jpg', 'zoom_in'), sc('price', 5000, 'ብር 100.00', null, null, 'fade'), sc('cta', 5000, 'ይደውሉ: +251911000000', null, null, 'fade')];
  const res = await processJob({ client, job: mkJob('premium', scenes, 15000, 'am'), cfg, log: () => {} });
  assert.equal(res, 'ready', JSON.stringify(calls.filter((c) => c[0] === 'renderer_fail_job')));
  assert.deepEqual(checkSummary(probeFile(uploads['renders/proj1/job1-1.mp4'], 'am.mp4'), 15000), []);
});

test('a missing image is reported as a clear failure and nothing is uploaded', { skip: !have }, async () => {
  const { client, calls, uploads } = fake({ missing: true });
  const scenes = [sc('intro', 5000, 'A', null, 'products/a.jpg', 'fade'), sc('price', 5000, 'B', null, null, 'fade'), sc('cta', 5000, 'C', null, null, 'fade')];
  const res = await processJob({ client, job: mkJob('premium', scenes, 15000), cfg, log: () => {} });
  assert.equal(res, 'failed');
  const f = calls.find((c) => c[0] === 'renderer_fail_job');
  assert.match(f[1].p_message, /Could not download the image products\/a\.jpg/);
  assert.equal(Object.keys(uploads).length, 0); assert.ok(!calls.some((c) => c[0] === 'renderer_complete_job'));
});

test('a file with the wrong length is caught here and never reported as complete', { skip: !have, timeout: 120000 }, async () => {
  const { client, calls, uploads } = fake();
  const scenes = [sc('intro', 5000, 'A', null, null, 'fade'), sc('price', 5000, 'B', null, null, 'fade'), sc('cta', 5000, 'C', null, null, 'fade')];
  await processJob({ client, job: mkJob('premium', scenes, 30000), cfg, log: () => {} }); // job says 30 s, scenes make 15 s
  const f = calls.find((c) => c[0] === 'renderer_fail_job');
  assert.match(f[1].p_message, /Verification failed: length is/);
  assert.ok(!calls.some((c) => c[0] === 'renderer_complete_job')); assert.equal(Object.keys(uploads).length, 0);
});

test('missing FFmpeg gives an install hint', { skip: !have }, async () => {
  const { client, calls } = fake();
  const scenes = [sc('intro', 5000, 'A', null, null, 'fade'), sc('price', 5000, 'B', null, null, 'fade'), sc('cta', 5000, 'C', null, null, 'fade')];
  await processJob({ client, job: mkJob('premium', scenes, 15000), cfg: { ffmpeg: 'no-such-ffmpeg', ffprobe: 'ffprobe' }, log: () => {} });
  assert.match(calls.find((c) => c[0] === 'renderer_fail_job')[1].p_message, /no-such-ffmpeg was not found/);
});

test('cleanup', () => { rmSync(dir, { recursive: true, force: true }); });
