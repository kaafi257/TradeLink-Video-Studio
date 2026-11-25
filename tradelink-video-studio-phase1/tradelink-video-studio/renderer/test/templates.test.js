import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEMPLATE_LAYOUT, templateLayout } from '../src/templates.js';
import { layoutScene } from '../src/layout.js';
import { processJob } from '../src/worker.js';
import { checkSummary } from '../src/verify.js';

const IDS = ['clean_product', 'bold_sale', 'wholesale_offer', 'supplier_spotlight', 'campaign_banner', 'story_quick'];
const have = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

test('there is a layout entry for each of the six templates and unknown ids change nothing', () => {
  assert.deepEqual(Object.keys(TEMPLATE_LAYOUT).sort(), [...IDS].sort());
  for (const bad of [null, undefined, 'nope', 'constructor', '__proto__', 5]) assert.deepEqual(templateLayout(bad), {});
});

test('without a template the layout is exactly the Phase 3 layout', () => {
  const sc = { scene_type: 'price', duration_ms: 4000, headline: 'ETB 80.00', body: 'ETB 100.00', animation: 'slide_up' };
  assert.deepEqual(layoutScene(sc, 'dynamic', false), layoutScene(sc, 'dynamic', false, null));
  assert.deepEqual(layoutScene(sc, 'dynamic', false), layoutScene(sc, 'dynamic', false, 'clean_product'));
  assert.equal(layoutScene(sc, 'premium', false).fadeS, 0.3);
});

test('templates change size and boxes but never the text', () => {
  const price = { scene_type: 'price', duration_ms: 4000, headline: 'ETB 80', body: null, animation: 'slide_up' };
  const a = layoutScene(price, 'dynamic', false);
  const b = layoutScene(price, 'dynamic', false, 'bold_sale');
  assert.ok(b.lines[0].size > a.lines[0].size, 'bold sale prices are bigger');
  assert.equal(b.lines[0].text, a.lines[0].text);
  const wh = { scene_type: 'wholesale', duration_ms: 4000, headline: 'Minimum order: 12', body: 'Request a Quote', animation: 'fade' };
  const h = (id) => layoutScene(wh, 'premium', false, id).boxes.find((x) => x.color === '0xe9a914').h;
  assert.ok(h('wholesale_offer') > h(null));
  assert.equal(layoutScene(wh, 'premium', false, 'story_quick').fadeS, 0.2);
  const img = { scene_type: 'intro', duration_ms: 4000, headline: 'Name', body: null, animation: 'fade' };
  const band = layoutScene(img, 'dynamic', true, 'bold_sale').boxes;
  assert.equal(band[0].color, '0xe9a914'); assert.equal(band[1].h, 16);
});

const dir = mkdtempSync(join(tmpdir(), 'tt-'));
let photo;
if (have) {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=800x600', '-frames:v', '1', join(dir, 'a.jpg')]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  photo = readFileSync(join(dir, 'a.jpg'));
}
const fake = () => {
  const calls = [];
  return { calls, client: {
    rpc: async (name, a) => { calls.push([name, a]); return { data: name === 'renderer_complete_job' ? 'ready' : 'failed', error: null }; },
    storage: { from: () => ({ download: async () => ({ data: new Blob([photo]), error: null }), upload: async () => ({ error: null }) }) },
  } };
};
const sc = (type, ms, headline, body, img, anim) => ({ scene_type: type, duration_ms: ms, headline, body, image_path: img, animation: anim });

for (const id of IDS) {
  test(`renders a real 15s MP4 with the ${id} template`, { skip: !have, timeout: 120000 }, async () => {
    const { client, calls } = fake();
    const scenes = [
      sc('intro', 3000, 'Test Shirt', null, 'products/a.jpg', 'zoom_in'),
      sc('product', 3000, 'Acme · 25 kg', 'Short description', 'products/a.jpg', 'pan_left'),
      sc('price', 3000, 'ETB 80.00', null, null, 'slide_up'),
      sc('wholesale', 3000, 'Minimum order: 12 bag', 'Request a Quote', null, 'reveal'),
      sc('cta', 3000, 'WhatsApp: +251911000000', null, null, 'fade'),
    ];
    const job = { id: 'j', project_id: 'p', attempt: 1, expected_ms: 15000, plan: { project: { style: 'dynamic', template_id: id, language: 'en' }, scenes } };
    const res = await processJob({ client, job, cfg: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, log: () => {} });
    assert.equal(res, 'ready');
    assert.ok(!calls.some((c) => c[0] === 'renderer_fail_job'));
    const done = calls.find((c) => c[0] === 'renderer_complete_job');
    const probe = done[1].p_probe;
    assert.deepEqual(checkSummary(probe, 15000), []);
    assert.equal(probe.width, 1080); assert.equal(probe.height, 1920);
    assert.ok(probe.size_bytes > 0);
  });
}
