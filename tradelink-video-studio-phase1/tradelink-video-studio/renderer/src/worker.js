// Renders one claimed job end to end. The `client` is a Supabase client signed in as the renderer account;
// tests pass a fake with the same three methods (rpc, storage.from().download/upload).
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { RenderError, blackArgs, buildRenderArgs, compositeArgs, coverArgs, probeArgs, run } from './ffmpeg.js';
import { wantsEthiopic } from './layout.js';
import { checkSummary, parseBlackDetect, pictureNotes, summarizeProbe } from './verify.js';

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts');

function friendly(e, workDir) {
  let m = e instanceof RenderError ? e.message : `Unexpected error: ${e?.message ?? e}`;
  m = m.split(workDir).join('<work>').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<token>');
  return m.slice(0, 480);
}

async function download(client, path) {
  const { data, error } = await client.storage.from('source-images').download(path);
  if (error || !data) throw new RenderError(`Could not download the image ${path}`);
  return Buffer.from(await data.arrayBuffer());
}

/** @returns 'ready' | 'retry' | 'failed' (what the database decided) */
export async function processJob({ client, job, cfg, log = () => {}, fontDir = FONT_DIR }) {
  const plan = job.plan;
  const scenes = plan?.scenes ?? [];
  const style = plan?.project?.style ?? 'premium';
  const templateId = plan?.project?.template_id ?? null;
  const pid = job.project_id;
  const work = await mkdtemp(join(tmpdir(), 'studio-render-'));
  try {
    if (scenes.length < 3) throw new RenderError('The job has fewer than 3 scenes');
    log(`Job ${job.id}: ${scenes.length} scenes, ${job.expected_ms / 1000}s, style ${style}${templateId ? `, template ${templateId}` : ''}, attempt ${job.attempt}`);

    const fontSrc = wantsEthiopic(scenes) ? 'NotoSansEthiopic-Bold.ttf' : 'DejaVuSans-Bold.ttf';
    await copyFile(join(fontDir, fontSrc), join(work, 'font.ttf'));

    // 1. images: download each once, then build the blurred-background still
    const imageFiles = new Map();
    let n = 0;
    for (const s of scenes) {
      if (!s.image_path || imageFiles.has(s.image_path)) continue;
      const raw = `img_${n}${extname(s.image_path).toLowerCase() || '.jpg'}`;
      const still = `bg_${n}.png`;
      await writeFile(join(work, raw), await download(client, s.image_path));
      await run(cfg.ffmpeg, compositeArgs(raw, still), { cwd: work });
      imageFiles.set(s.image_path, still);
      n++;
    }

    // 2. the video
    const { args, textFiles } = buildRenderArgs(scenes, { style, imageFiles, fontFile: 'font.ttf', templateId });
    for (const [name, text] of Object.entries(textFiles)) await writeFile(join(work, name), text, 'utf8');
    log('Rendering with FFmpeg…');
    await run(cfg.ffmpeg, args, { cwd: work });

    // 3. check the file we actually made
    const probe = JSON.parse((await run(cfg.ffprobe, probeArgs('out.mp4'), { cwd: work })).out);
    const summary = summarizeProbe(probe);
    const problems = checkSummary(summary, job.expected_ms);
    if (problems.length) throw new RenderError(`Verification failed: ${problems.join('; ')}`);

    // 4. cover picture from the opening scene
    await run(cfg.ffmpeg, coverArgs('out.mp4', 'cover.jpg', Math.min(1, scenes[0].duration_ms / 2000)), { cwd: work });

    // 4b. picture notice (a warning only): a very dark stretch or cover, for the reviewer to look at
    const vb = parseBlackDetect((await run(cfg.ffmpeg, blackArgs('out.mp4'), { cwd: work })).err);
    const cb = parseBlackDetect((await run(cfg.ffmpeg, blackArgs('cover.jpg', { image: true }), { cwd: work })).err);
    const notes = pictureNotes({ videoBlack: vb, coverBlack: cb });
    if (notes) { summary.picture = notes; log(`Picture notice: ${JSON.stringify(notes)}`); }

    // 5. upload (a new file name per attempt: the renderer may add files but never overwrite)
    const base = `${pid}/${job.id}-${job.attempt}`;
    const outPath = `${base}.mp4`;
    const coverPath = `${base}.jpg`;
    const up1 = await client.storage.from('renders').upload(outPath, await readFile(join(work, 'out.mp4')), { contentType: 'video/mp4', upsert: false });
    if (up1.error) throw new RenderError('Could not upload the video to storage');
    const up2 = await client.storage.from('covers').upload(coverPath, await readFile(join(work, 'cover.jpg')), { contentType: 'image/jpeg', upsert: false });
    if (up2.error) throw new RenderError('Could not upload the cover image to storage');

    // 6. report. Only the database can turn this into "Ready to post", and it repeats the format check.
    const done = await client.rpc('renderer_complete_job', { p_job: job.id, p_output: outPath, p_cover: coverPath, p_probe: summary });
    if (done.error) throw new RenderError(`The database refused the result: ${done.error.message}`);
    log(`Job ${job.id}: ${done.data}`);
    return done.data;
  } catch (e) {
    const message = friendly(e, work);
    log(`Job ${job.id} failed: ${message}`);
    try {
      const r = await client.rpc('renderer_fail_job', { p_job: job.id, p_message: message });
      return r.error ? 'unreported' : r.data;
    } catch {
      return 'unreported'; // the database re-offers a stuck job after 30 minutes
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
