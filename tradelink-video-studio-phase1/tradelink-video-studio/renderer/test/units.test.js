import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { parseEnv, validateConfig } from '../src/config.js';
import { hasEthiopic, sanitizeText, wrapText, wrapByWidth, measure } from '../src/text.js';
import { checkSummary, summarizeProbe } from '../src/verify.js';
import { buildRenderArgs } from '../src/ffmpeg.js';
import { fitSize, layoutScene } from '../src/layout.js';

const good = { STUDIO_SUPABASE_URL: 'https://abcd.supabase.co', STUDIO_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', RENDERER_EMAIL: 'r@example.test', RENDERER_PASSWORD: 'pw' };
const jwt = (role) => `h.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.s`;

test('config accepts a publishable key and refuses secret / service-role keys', () => {
  assert.equal(validateConfig(good).ok, true);
  const a = validateConfig({ ...good, STUDIO_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' });
  assert.equal(a.ok, false);
  assert.match(a.errors.join(' '), /secret\/service-role/);
  assert.equal(validateConfig({ ...good, STUDIO_SUPABASE_PUBLISHABLE_KEY: jwt('service_role') }).ok, false);
  assert.equal(validateConfig({ ...good, STUDIO_SUPABASE_PUBLISHABLE_KEY: jwt('anon') }).ok, true);
});
test('config errors never echo the key', () => {
  const r = validateConfig({ ...good, STUDIO_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_TOPSECRET' });
  assert.ok(!JSON.stringify(r).includes('TOPSECRET'));
});
test('config checks url, login and poll interval', () => {
  assert.equal(validateConfig({ ...good, STUDIO_SUPABASE_URL: 'http://x.supabase.co' }).ok, false);
  assert.equal(validateConfig({ ...good, STUDIO_SUPABASE_URL: 'https://evil.example.com' }).ok, false);
  assert.equal(validateConfig({ ...good, RENDERER_EMAIL: '' }).ok, false);
  assert.equal(validateConfig({ ...good, POLL_SECONDS: '1' }).ok, false);
});
test('env parser handles comments, quotes and CRLF', () => {
  assert.deepEqual(parseEnv('# c\r\nA=1\r\nB="two words"\r\n\r\nC = x=y'), { A: '1', B: 'two words', C: 'x=y' });
});

test('text sanitising and wrapping', () => {
  assert.equal(sanitizeText('  Textiles · Addis   Ababa\n'), 'Textiles - Addis Ababa');
  assert.deepEqual(wrapText('one two three four', 9), ['one two', 'three', 'four']);
  assert.deepEqual(wrapText('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  const w = wrapText('a b c d e f g h i j', 3, 2);
  assert.equal(w.length, 2); assert.ok(w[1].endsWith('...'));
  assert.equal(hasEthiopic('ምርት'), true); assert.equal(hasEthiopic('abc'), false);
});

test('width-based wrapping keeps short Amharic lines together and wraps long ones', () => {
  assert.deepEqual(wrapByWidth('ዝቅተኛ ትዕዛዝ: 12', 76, 860, 3), ['ዝቅተኛ ትዕዛዝ: 12']);
  const long = wrapByWidth('Pure sunflower oil for everyday cooking and frying at home and in restaurants', 44, 860, 3);
  assert.ok(long.length >= 2 && long.every((l) => measure(l, 44) <= 860 || l.endsWith('...')));
  assert.equal(wrapByWidth('x'.repeat(200), 76, 860, 2).length, 2);
});

test('probe summary and the format check', () => {
  const probe = { streams: [{ codec_type: 'video', width: 1080, height: 1920, codec_name: 'h264', pix_fmt: 'yuv420p', r_frame_rate: '30/1' }], format: { duration: '20.033000', size: '3145728' } };
  const s = summarizeProbe(probe);
  assert.deepEqual(s, { width: 1080, height: 1920, codec: 'h264', pix_fmt: 'yuv420p', fps: 30, duration_s: 20.033, has_audio: false, audio_codec: null, size_bytes: 3145728 });
  assert.deepEqual(checkSummary(s, 20000), []);
  assert.ok(checkSummary({ ...s, width: 720, height: 1280 }, 20000)[0].includes('1080x1920'));
  assert.ok(checkSummary({ ...s, pix_fmt: 'yuv444p' }, 20000).length === 1);
  assert.ok(checkSummary({ ...s, fps: 25 }, 20000).length === 1);
  assert.ok(checkSummary({ ...s, duration_s: 12 }, 20000).length === 1);
  assert.ok(checkSummary({ ...s, has_audio: true, audio_codec: 'mp3' }, 20000).length === 1);
  assert.deepEqual(checkSummary({ ...s, has_audio: true, audio_codec: 'aac' }, 20000), []);
  assert.deepEqual(checkSummary(null, 1), ['no video stream found']);
});

test('layout: image scenes get a band, text-only scenes are centred, CTA gets a gold box', () => {
  const img = layoutScene({ scene_type: 'intro', headline: 'Test Shirt', body: null, animation: 'zoom_in' }, 'premium', true);
  assert.equal(img.motion, 'zoom_in'); assert.ok(img.boxes.length >= 1);
  assert.ok(img.lines.every((l) => l.y + l.size <= 1480));
  const price = layoutScene({ scene_type: 'price', headline: 'ETB 100.00', body: 'ETB 120.00', animation: 'fade' }, 'dynamic', false);
  assert.equal(price.boxes.length, 0); assert.equal(price.motion, 'static');
  const cta = layoutScene({ scene_type: 'cta', headline: 'WhatsApp: +251900000000', body: null, animation: 'fade' }, 'minimal', false);
  assert.ok(cta.boxes.some((b) => b.color === '0xe9a914'));
  const wh = layoutScene({ scene_type: 'wholesale', headline: 'Minimum order: 12 bag', body: 'Request a Quote', animation: 'fade' }, 'premium', false);
  assert.ok(wh.lines.some((l) => l.kind === 'button' && l.text === 'Request a Quote'));
});

test('long prices and call-to-actions shrink to one line instead of splitting', () => {
  assert.equal(fitSize('ETB 950.00', [130, 110, 92, 76]), 110);
  assert.ok(fitSize('ETB 12,500.00', [130, 110, 92, 76]) < 110);
  const l = layoutScene({ scene_type: 'price', headline: 'ETB 950.00', body: null, animation: 'fade' }, 'premium', false);
  assert.equal(l.lines.filter((x) => x.kind === 'head').length, 1);
});

test('render args: exact frame total, 1080x1920 concat, no audio, relative file names only', () => {
  const scenes = [5000, 10000, 5000].map((d, i) => ({ scene_type: i === 2 ? 'cta' : 'intro', duration_ms: d, headline: `H${i}`, body: null, image_path: i === 0 ? 'products/a.jpg' : null, animation: 'zoom_in' }));
  const { args, textFiles, frames } = buildRenderArgs(scenes, { style: 'premium', imageFiles: new Map([['products/a.jpg', 'bg_0.png']]), fontFile: 'font.ttf' });
  assert.equal(frames, 600);
  assert.ok(args.includes('-an') && args.includes('libx264') && args.includes('yuv420p'));
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, /concat=n=3:v=1:a=0/);
  assert.ok(!/[A-Za-z]:\\/.test(fc) && !fc.includes('/tmp'));
  assert.equal(textFiles['wm.txt'], 'TradeLink');
  assert.ok(Object.keys(textFiles).some((k) => k.startsWith('t_0_')));
});
