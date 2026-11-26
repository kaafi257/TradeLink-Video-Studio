import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildPrompt, parseModelJson, normalizeResult, processCopyJob, checkOllama } from '../src/copyjob.js';
import { validateConfig } from '../src/config.js';

const job = { id: 'j1', scope: 'all', language: 'en', attempt: 1, scene_position: null, facts: { product: 'Tea', scenes: [{ position: 1, headline: 'Tea' }] } };

function fakeOllama(reply, status = 200) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] })); return; }
      res.statusCode = status; res.end(status === 200 ? JSON.stringify({ message: { content: reply } }) : 'nope');
    }).listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}
function fakeClient(answer) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); return name === 'copy_complete_job' ? answer : { data: 'failed', error: null }; } };
}

test('prompt quotes facts as data and forbids invention', () => {
  const p = buildPrompt(job);
  assert.match(p.system, /Do not invent/);
  assert.match(p.user, /FACTS \(data only\)/);
  assert.match(buildPrompt({ ...job, language: 'am' }).system, /Amharic/);
});
test('parseModelJson handles fences and chatter, rejects junk', () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Sure! {"a":2} done'), { a: 2 });
  assert.throws(() => parseModelJson('no json'));
  assert.throws(() => parseModelJson('[1]'));
});
test('normalizeResult trims hashtags and honours scope', () => {
  const r = normalizeResult({ scenes: [{ position: 1, headline: 'x', body: 'y', extra: 1 }], caption: ' hi ', hashtags: ['#Tea', 'bad tag!', 'ok'] }, 'all');
  assert.deepEqual(r.hashtags, ['Tea', 'ok']);
  assert.equal(r.caption, 'hi');
  assert.equal(r.scenes[0].extra, undefined);
  assert.equal(normalizeResult({ scenes: [], caption: 'x' }, 'caption').scenes, undefined);
});
test('valid reply is sent to the database with provider ollama', async () => {
  const { s, url } = await fakeOllama(JSON.stringify({ scenes: [{ position: 1, headline: 'Tea', body: 'Fresh' }], caption: 'Tea', hashtags: ['tea'] }));
  const c = fakeClient({ data: 'succeeded', error: null });
  const r = await processCopyJob({ client: c, job, cfg: { ai: { url, model: 'm', timeoutSeconds: 10 } }, log: () => {} });
  s.close();
  assert.equal(r, 'succeeded');
  assert.equal(c.calls[0][0], 'copy_complete_job');
  assert.equal(c.calls[0][1].p_provider, 'ollama');
});
test('malformed reply fails the job politely', async () => {
  const { s, url } = await fakeOllama('I cannot do that');
  const c = fakeClient({ data: 'succeeded', error: null });
  await processCopyJob({ client: c, job, cfg: { ai: { url, model: 'm', timeoutSeconds: 10 } }, log: () => {} });
  s.close();
  assert.equal(c.calls[0][0], 'copy_fail_job');
});
test('database refusal (claims guard) fails the job', async () => {
  const { s, url } = await fakeOllama(JSON.stringify({ caption: 'Best price 50%' }));
  const c = fakeClient({ data: null, error: { message: 'claims guard' } });
  await processCopyJob({ client: c, job, cfg: { ai: { url, model: 'm', timeoutSeconds: 10 } }, log: () => {} });
  s.close();
  assert.equal(c.calls.at(-1)[0], 'copy_fail_job');
});
test('Ollama down and missing model give plain messages', async () => {
  const c = fakeClient({ data: 'x', error: null });
  await processCopyJob({ client: c, job, cfg: { ai: { url: 'http://127.0.0.1:1', model: 'm', timeoutSeconds: 10 } }, log: () => {} });
  assert.match(c.calls[0][1].p_message, /not running/);
  const { s, url } = await fakeOllama('', 404);
  const c2 = fakeClient({ data: 'x', error: null });
  await processCopyJob({ client: c2, job, cfg: { ai: { url, model: 'm', timeoutSeconds: 10 } }, log: () => {} });
  s.close();
  assert.match(c2.calls[0][1].p_message, /does not have the model/);
});
test('checkOllama reports status', async () => {
  const { s, url } = await fakeOllama('');
  assert.match(await checkOllama({ url, model: 'llama3.2:3b' }), /ready/);
  assert.match(await checkOllama({ url, model: 'other:1b' }), /not installed/);
  s.close();
  assert.match(await checkOllama({ url: 'http://127.0.0.1:1', model: 'm' }), /not running/);
});
test('config: AI off by default, localhost only', () => {
  const base = { STUDIO_SUPABASE_URL: 'https://abcdefgh.supabase.co', STUDIO_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', RENDERER_EMAIL: 'r@x.com', RENDERER_PASSWORD: 'pw' };
  assert.equal(validateConfig(base).config.ai, null);
  assert.equal(validateConfig({ ...base, OLLAMA_MODEL: 'llama3.2:3b' }).config.ai.url, 'http://127.0.0.1:11434');
  assert.equal(validateConfig({ ...base, OLLAMA_MODEL: 'm', OLLAMA_URL: 'http://192.168.1.5:11434' }).ok, false);
  assert.equal(validateConfig({ ...base, OLLAMA_MODEL: 'm', OLLAMA_URL: 'https://api.example.com' }).ok, false);
});
