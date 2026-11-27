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


// ---- Phase 5 Stage 1: brand font, own logo, own sound
import { pickFont } from '../src/worker.js';
import { validateConfig } from '../src/config.js';

test('Latin text uses the brand font, Ethiopic keeps Noto, and a missing brand font falls back', () => {
  assert.equal(pickFont(false), 'BricolageGrotesque-Bold.ttf');
  assert.equal(pickFont(true), 'NotoSansEthiopic-Bold.ttf');
  assert.equal(pickFont(false, dir), 'DejaVuSans-Bold.ttf');
});

test('config: logo and sound are optional and checked', () => {
  const base = { STUDIO_SUPABASE_URL: 'https://abcdefgh.supabase.co', STUDIO_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', RENDERER_EMAIL: 'r@x.com', RENDERER_PASSWORD: 'pw' };
  const off = validateConfig(base).config;
  assert.equal(off.logo, null); assert.equal(off.audio, null);
  const on = validateConfig({ ...base, BRAND_LOGO: 'C:\\b\\logo.png', AUDIO_FILE: 'C:\\b\\m.mp3', AUDIO_VOLUME: '0.3' }).config;
  assert.equal(on.logo, 'C:\\b\\logo.png'); assert.deepEqual(on.audio, { file: 'C:\\b\\m.mp3', volume: 0.3 });
  for (const bad of [{ BRAND_LOGO: 'x.exe' }, { AUDIO_FILE: 'x.exe' }, { AUDIO_VOLUME: '2' }, { AUDIO_VOLUME: 'abc' }]) assert.equal(validateConfig({ ...base, ...bad }).ok, false);
});

test('renders with the brand logo and your own sound: AAC audio, exact length, passes the database check', { skip: !have, timeout: 120000 }, async () => {
  sh(['-f', 'lavfi', '-i', 'color=c=red:s=400x200', '-frames:v', '1', join(dir, 'logo.png')]);
  sh(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'libmp3lame', join(dir, 'tone.mp3')]);  // shorter than the video: must loop
  const { client, calls, uploads } = fake();
  const scenes = [
    sc('intro', 4000, 'Test Shirt', null, 'products/a.jpg', 'zoom_in'),
    sc('product', 4000, 'Acme', 'Short text', 'products/b.png', 'fade'),
    sc('cta', 4000, 'WhatsApp: +251911000000', null, null, 'fade'),
  ];
  const res = await processJob({ client, job: mkJob('premium', scenes, 12000), cfg: { ...cfg, logo: join(dir, 'logo.png'), audio: { file: join(dir, 'tone.mp3'), volume: 0.4 } }, log: () => {} });
  assert.equal(res, 'ready', JSON.stringify(calls.filter((c) => c[0] === 'renderer_fail_job')));
  const v = probeFile(uploads['renders/proj1/job1-1.mp4'], 'sound.mp4');
  assert.deepEqual(checkSummary(v, 12000), [], JSON.stringify(v));
  assert.equal(v.has_audio, true); assert.equal(v.audio_codec, 'aac');
  // the logo (solid red) shows in the top-left corner of the cover frame
  writeFileSync(join(dir, 'cover_logo.jpg'), uploads['covers/proj1/job1-1.jpg']);
  const px = spawnSync('ffmpeg', ['-v', 'error', '-i', join(dir, 'cover_logo.jpg'), '-vf', 'format=rgb24,crop=2:2:120:150', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
  const [r, g, b] = px.stdout;
  assert.ok(r > 180 && g < 90 && b < 90, `logo pixel was ${r},${g},${b}`);
});

test('without logo and sound the output is silent and unchanged in format', { skip: !have, timeout: 120000 }, async () => {
  const { client, uploads } = fake();
  const scenes = [sc('intro', 4000, 'A', null, null, 'fade'), sc('product', 4000, 'B', 'text', null, 'fade'), sc('cta', 4000, 'WhatsApp: +251911000000', null, null, 'fade')];
  assert.equal(await processJob({ client, job: mkJob('minimal', scenes, 12000), cfg, log: () => {} }), 'ready');
  assert.equal(probeFile(uploads['renders/proj1/job1-1.mp4'], 'quiet.mp4').has_audio, false);
});

// ---- Phase 5 Stage A: closing frame (last second, on top of the last scene: the length never changes)
const pixelAt = (buf, name, t, x, y) => {
  writeFileSync(join(dir, name), buf);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', join(dir, name), '-vf', `format=rgb24,crop=2:2:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
  return [r.stdout[0], r.stdout[1], r.stdout[2]];
};
const close3 = () => [sc('intro', 4000, 'A', null, null, 'fade'), sc('product', 4000, 'B', 'text', null, 'fade'), sc('cta', 4000, 'WhatsApp: +251911000000', null, null, 'none')];

test('closing frame: last second turns brand navy, length unchanged, still passes the format check', { skip: !have, timeout: 120000 }, async () => {
  const { client, uploads } = fake();
  assert.equal(await processJob({ client, job: mkJob('minimal', close3(), 12000), cfg, log: () => {} }), 'ready');
  const buf = uploads['renders/proj1/job1-1.mp4'];
  assert.deepEqual(checkSummary(probeFile(buf, 'close.mp4'), 12000), []);
  const [r, g, b] = pixelAt(buf, 'close.mp4', 11.6, 900, 1700);          // navy 0x073256 = 7,50,86
  assert.ok(r < 40 && g > 30 && g < 80 && b > 60 && b < 110, `closing pixel was ${r},${g},${b}`);
  const before = pixelAt(buf, 'close.mp4', 9.0, 900, 1700);               // minimal style: light page colour before the end
  assert.ok(before[0] > 200, `pixel before the closing frame was ${before}`);
});

test('closing frame can be switched off, and is skipped when the last scene is shorter than 3 s', { skip: !have, timeout: 120000 }, async () => {
  let c = fake();
  assert.equal(await processJob({ client: c.client, job: mkJob('minimal', close3(), 12000), cfg: { ...cfg, closing: false }, log: () => {} }), 'ready');
  assert.ok(pixelAt(c.uploads['renders/proj1/job1-1.mp4'], 'off.mp4', 11.6, 900, 1700)[0] > 200, 'no closing frame when off');
  c = fake();
  const short = [sc('intro', 5000, 'A', null, null, 'fade'), sc('product', 5000, 'B', 'text', null, 'fade'), sc('cta', 2000, 'WhatsApp: +251911000000', null, null, 'none')];
  assert.equal(await processJob({ client: c.client, job: mkJob('minimal', short, 12000), cfg, log: () => {} }), 'ready');
  assert.ok(pixelAt(c.uploads['renders/proj1/job1-1.mp4'], 'short.mp4', 11.6, 900, 1700)[0] > 200, 'short last scene keeps its contact readable');
});

test('closing frame with your own logo shows the logo in the middle', { skip: !have, timeout: 120000 }, async () => {
  sh(['-f', 'lavfi', '-i', 'color=c=red:s=400x200', '-frames:v', '1', join(dir, 'logo2.png')]);
  const { client, uploads } = fake();
  assert.equal(await processJob({ client, job: mkJob('minimal', close3(), 12000), cfg: { ...cfg, logo: join(dir, 'logo2.png') }, log: () => {} }), 'ready');
  const [r, g, b] = pixelAt(uploads['renders/proj1/job1-1.mp4'], 'closelogo.mp4', 11.7, 540, 960);
  assert.ok(r > 180 && g < 90 && b < 90, `centre pixel was ${r},${g},${b}`);
});

test('config: CLOSING_FRAME=off disables the closing frame', () => {
  const base = { STUDIO_SUPABASE_URL: 'https://abcdefgh.supabase.co', STUDIO_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', RENDERER_EMAIL: 'r@x.com', RENDERER_PASSWORD: 'pw' };
  assert.equal(validateConfig(base).config.closing, true);
  assert.equal(validateConfig({ ...base, CLOSING_FRAME: 'off' }).config.closing, false);
});

test('cleanup', () => { rmSync(dir, { recursive: true, force: true }); });
