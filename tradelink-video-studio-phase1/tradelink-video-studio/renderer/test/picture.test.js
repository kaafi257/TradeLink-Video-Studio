import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBlackDetect, pictureNotes } from '../src/verify.js';
import { processJob } from '../src/worker.js';

const have = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

test('parses blackdetect output', () => {
  const err = '[blackdetect @ 0x1] black_start:3 black_end:6.5 black_duration:3.5\n[blackdetect @ 0x1] black_start:10 black_end:12 black_duration:2\n';
  assert.deepEqual(parseBlackDetect(err), [{ start: 3, end: 6.5, duration: 3.5 }, { start: 10, end: 12, duration: 2 }]);
  assert.deepEqual(parseBlackDetect(''), []);
  assert.deepEqual(parseBlackDetect(undefined), []);
});

test('picture notes are warnings with plain numbers', () => {
  assert.equal(pictureNotes({}), null);
  assert.deepEqual(pictureNotes({ videoBlack: [{ start: 3, end: 6, duration: 3 }, { start: 8.04, end: 12, duration: 3.96 }] }), { dark_seconds: 4, dark_start: 8 });
  assert.deepEqual(pictureNotes({ coverBlack: [{ start: 0, end: 2, duration: 2 }] }), { cover_dark: true });
});

const dir = mkdtempSync(join(tmpdir(), 'pt-'));
const mk = (name, src) => {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', src, '-frames:v', '1', join(dir, name)]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return readFileSync(join(dir, name));
};
const good = have ? mk('g.jpg', 'testsrc2=size=800x600') : null;
const black = have ? mk('b.jpg', 'color=c=black:size=800x600') : null;

const fake = (photo) => {
  const calls = [];
  return { calls, client: {
    rpc: async (name, a) => { calls.push([name, a]); return { data: name === 'renderer_complete_job' ? 'ready' : 'failed', error: null }; },
    storage: { from: () => ({ download: async () => ({ data: new Blob([photo]), error: null }), upload: async () => { calls.push(['upload']); return { error: null }; } }) },
  } };
};
const scenes = [
  { scene_type: 'intro', duration_ms: 4000, headline: 'Test Shirt', body: null, image_path: 'products/a.jpg', animation: 'none' },
  { scene_type: 'product', duration_ms: 4000, headline: 'Acme', body: null, image_path: 'products/a.jpg', animation: 'none' },
  { scene_type: 'cta', duration_ms: 4000, headline: 'Call: 1', body: null, image_path: null, animation: 'none' },
];
const job = { id: 'j', project_id: 'p', attempt: 1, expected_ms: 12000, plan: { project: { style: 'premium', language: 'en' }, scenes } };
const cfg = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

test('a normal render uploads', { skip: !have, timeout: 120000 }, async () => {
  const { client, calls } = fake(good);
  assert.equal(await processJob({ client, job, cfg, log: () => {} }), 'ready');
  assert.ok(calls.some((c) => c[0] === 'upload'));
});

test('a good render carries no picture notice', { skip: !have, timeout: 120000 }, async () => {
  const { client, calls } = fake(good);
  await processJob({ client, job, cfg, log: () => {} });
  assert.equal(calls.find((c) => c[0] === 'renderer_complete_job')[1].p_probe.picture, undefined);
});

test('black pictures still render and upload, but carry a warning for the reviewer', { skip: !have, timeout: 120000 }, async () => {
  const { client, calls } = fake(black);
  assert.equal(await processJob({ client, job, cfg, log: () => {} }), 'ready');
  const done = calls.find((c) => c[0] === 'renderer_complete_job');
  assert.ok(done, 'job completed');
  assert.ok(done[1].p_probe.picture.dark_seconds >= 1.5, JSON.stringify(done[1].p_probe.picture));
  assert.equal(done[1].p_probe.picture.cover_dark, true);
  assert.ok(!calls.some((c) => c[0] === 'renderer_fail_job'));
});
