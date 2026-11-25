import { useCallback, useEffect, useState } from 'react';
import { runQualityChecks, type QualityCheck, type QualityReport } from '../../lib/quality';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { canWriteCatalogue, formatDate } from '../../lib/catalogue';
import { signedUrlsIn } from '../../lib/images';
import { useImageUrls } from '../../lib/useImageUrls';
import { markTyped, type Animation, type Scene } from '../../lib/scenes';
import {
  availableActions, describeFile, formatHashtags, isEditable, parseHashtags, parseSeconds, postText, sceneTotalMs, timeMatches,
  type RenderJob, type StatusHistoryRow, type VideoAction, type VideoProject, type VideoSceneRow,
} from '../../lib/videos';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';
import { StatusChip } from './Videos';

const ANIMATIONS: Animation[] = ['none', 'fade', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'slide_up', 'slide_left', 'reveal'];
interface Draft { id: string; headline: string; body: string; seconds: string; animation: Animation }

function toDrafts(rows: VideoSceneRow[]): Draft[] {
  return rows.map((r) => ({ id: r.id, headline: r.headline ?? '', body: r.body ?? '', seconds: String(r.duration_ms / 1000), animation: r.animation }));
}

export function VideoEditor() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const { profile } = useAuth();
  const canWrite = canWriteCatalogue(profile);
  const [video, setVideo] = useState<VideoProject | null>(null);
  const [scenes, setScenes] = useState<VideoSceneRow[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [history, setHistory] = useState<StatusHistoryRow[]>([]);
  const [files, setFiles] = useState<{ video?: string; cover?: string }>({});
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [postTime, setPostTime] = useState('');
  const [confirmPublished, setConfirmPublished] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [v, sc, jb, h] = await Promise.all([
      supabase.from('video_projects').select('*').eq('id', id).maybeSingle(),
      supabase.from('video_scenes').select('*').eq('project_id', id).order('position'),
      supabase.from('render_jobs').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(1),
      supabase.from('video_status_history').select('*').eq('project_id', id).order('at', { ascending: false }),
    ]);
    if (v.error || sc.error || jb.error || h.error) return setState('failed');
    if (!v.data) return setState('missing');
    const proj = v.data as VideoProject;
    setVideo(proj);
    const rows = (sc.data ?? []) as VideoSceneRow[];
    setScenes(rows);
    setDrafts(toDrafts(rows));
    setCaption(proj.caption ?? '');
    setTags(formatHashtags(proj.hashtags ?? []));
    setPostTime(proj.suggested_post_time ?? '');
    const latest = ((jb.data ?? []) as RenderJob[])[0] ?? null;
    setJob(latest);
    setHistory((h.data ?? []) as StatusHistoryRow[]);
    setState('ready');
    if (proj.status === 'ready_to_post' || proj.status === 'published_manually') {
      const done = latest?.status === 'succeeded' ? latest : null;
      if (done?.output_path && done.cover_path) {
        const [vv, cc] = await Promise.all([
          signedUrlsIn('renders', [done.output_path], `${proj.title}.mp4`),
          signedUrlsIn('covers', [done.cover_path], `${proj.title}-cover`),
        ]);
        setFiles({ video: vv[done.output_path], cover: cc[done.cover_path] });
      }
    } else setFiles({});
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const urls = useImageUrls(scenes.map((s) => s.image_path));

  if (state === 'loading') return <p className="muted">{t('common.loading')}</p>;
  if (state === 'failed') return <p role="alert" className="error">{t('common.loadError')}</p>;
  if (state === 'missing' || !video) return <><p><Link to="/videos">← {t('vid.back')}</Link></p><p className="card">{t('vid.ed.notFound')}</p></>;

  const editable = canWrite && isEditable(video.status);
  const parsed = drafts.map((d) => parseSeconds(d.seconds));
  const secondsOk = parsed.every((x) => x !== null);
  const total = sceneTotalMs(parsed.map((x) => ({ duration_ms: x ?? 0 })));
  const timeOk = secondsOk && timeMatches(total, video.duration_seconds);
  const tagList = parseHashtags(tags);
  const actions = availableActions(video.status, canWrite);
  const picture = (job?.probe?.picture ?? null) as { dark_seconds?: number; dark_start?: number; cover_dark?: boolean } | null;

  function setDraft(i: number, patch: Partial<Draft>) {
    setDrafts((ds) => ds.map((d, k) => (k === i ? { ...d, ...patch } : d)));
    setMsg(null);
  }

  async function saveScenes() {
    if (!supabase || !secondsOk) return;
    setBusy(true);
    let failed = false;
    for (const [i, d] of drafts.entries()) {
      const orig = scenes[i]!;
      let sc: Scene = { ...orig, source: orig.source };
      if ((d.headline || null) !== orig.headline) sc = markTyped(sc, 'headline', d.headline.trim() || null);
      if ((d.body || null) !== orig.body) sc = markTyped(sc, 'body', d.body.trim() || null);
      const { error } = await supabase.from('video_scenes').update({
        headline: sc.headline, body: sc.body, source: sc.source, duration_ms: parsed[i], animation: d.animation,
      }).eq('id', d.id);
      if (error) { failed = true; break; }
    }
    setBusy(false);
    setMsg(failed ? { kind: 'error', text: t('common.saveError') } : { kind: 'ok', text: t('vid.ed.saved') });
    await load();
  }

  async function saveDetails() {
    if (!supabase || tagList === 'invalid') return;
    setBusy(true);
    const { error } = await supabase.from('video_projects').update({
      caption: caption.trim() || null, hashtags: tagList, suggested_post_time: postTime.trim() || null,
    }).eq('id', id);
    setBusy(false);
    setMsg(error ? { kind: 'error', text: t('common.saveError') } : { kind: 'ok', text: t('vid.ed.saved') });
    await load();
  }

  /** Runs the quality check on the SAVED draft and stores the report. Returns it, or null when it could not be saved. */
  async function runCheck(): Promise<QualityReport | null> {
    if (!supabase || !video) return null;
    const prod = video.video_type === 'product_showcase' || video.video_type === 'wholesale_offer';
    const [pr, su, ca, co] = await Promise.all([
      prod && video.product_id ? supabase.from('products').select('*').eq('id', video.product_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      video.supplier_id ? supabase.from('suppliers').select('*').eq('id', video.supplier_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      video.campaign_id ? supabase.from('campaigns').select('*').eq('id', video.campaign_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      video.supplier_id ? supabase.from('supplier_consents').select('withdrawn').eq('supplier_id', video.supplier_id) : Promise.resolve({ data: [], error: null }),
    ]);
    if (pr.error || su.error || ca.error || co.error) return null;
    const report = runQualityChecks({
      project: video, scenes, product: pr.data as never, supplier: su.data as never, campaign: ca.data as never,
      consented: ((co.data ?? []) as Array<{ withdrawn: boolean }>).some((c) => !c.withdrawn),
    });
    const { error } = await supabase.rpc('save_quality_report', { p_project: id, p_report: report });
    if (error) return null;
    await load();
    return report;
  }

  async function checkOnly() {
    setBusy(true);
    const r = await runCheck();
    setBusy(false);
    setMsg(r ? null : { kind: 'error', text: t('vid.q.error') });
  }

  async function run(action: VideoAction) {
    if (!supabase) return;
    setBusy(true);
    if (action === 'queue' && editable) {
      const r = await runCheck();
      if (!r) { setBusy(false); return setMsg({ kind: 'error', text: t('vid.q.error') }); }
      if (r.status === 'fail') { setBusy(false); return setMsg({ kind: 'error', text: t('vid.q.blocked') }); }
    }
    let error: { message?: string } | null = null;
    if (action === 'queue') ({ error } = await supabase.rpc('queue_video', { p_project: id }));
    else if (action === 'cancel') ({ error } = await supabase.rpc('cancel_video', { p_project: id }));
    else {
      const next = action === 'archive' ? 'archived' : action === 'backToDraft' ? 'draft' : 'published_manually';
      ({ error } = await supabase.from('video_projects').update({ status: next }).eq('id', id));
    }
    setBusy(false);
    setConfirmPublished(false);
    setMsg(error ? { kind: 'error', text: `${t('vid.act.error')}${error.message ? ` (${error.message})` : ''}` } : null);
    await load();
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(postText(caption, Array.isArray(tagList) ? tagList : []));
      setMsg({ kind: 'ok', text: t('vid.ed.copied') });
    } catch { /* clipboard unavailable: the text stays visible above */ }
  }

  return (
    <>
      <p><Link to="/videos">← {t('vid.back')}</Link></p>
      <div className="row between"><h1>{video.title}</h1><StatusChip status={video.status} /></div>
      <p className="muted small">
        {t(`vid.type.${video.video_type}` as MessageKey)} · {video.duration_seconds} s · {t(`vid.style.${video.style}` as MessageKey)} · {video.language.toUpperCase()} · {formatDate(video.created_at)}
      </p>
      {video.language !== 'en' && <p className="draft-notice" role="note"><strong>DRAFT</strong> · {t(video.language === 'so' ? 'vid.ed.soDraft' : 'vid.ed.amDraft')}</p>}
      {video.status_note && <p className={video.status === 'failed' ? 'error' : 'muted'} role={video.status === 'failed' ? 'alert' : undefined}>{video.status_note}</p>}
      {!canWrite && <p className="muted">{t('vid.ed.readOnly')}</p>}
      {canWrite && !editable && video.status !== 'archived' && <p className="muted">{t('vid.ed.frozen')}</p>}
      {(video.status === 'queued' || video.status === 'rendering') && <p className="muted">{t('vid.ed.rendererNote')}</p>}
      {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={msg.kind === 'error' ? 'error' : 'ok'}>{msg.text}</p>}

      {actions.length > 0 && (
        <div className="row actions">
          {actions.includes('queue') && <button type="button" className="btn btn-primary" disabled={busy || (editable && !timeOk)} onClick={() => void run('queue')}>{t('vid.act.queue')}</button>}
          {actions.includes('cancel') && <button type="button" className="btn" disabled={busy} onClick={() => void run('cancel')}>{t('vid.act.cancel')}</button>}
          {actions.includes('backToDraft') && <button type="button" className="btn" disabled={busy} onClick={() => void run('backToDraft')}>{t('vid.act.backToDraft')}</button>}
          {actions.includes('archive') && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run('archive')}>{t('vid.act.archive')}</button>}
        </div>
      )}

      {(video.status === 'ready_to_post' || video.status === 'published_manually') && (
        <section className="card">
          <h2>{t('vid.status.ready_to_post')}</h2>
          <p className="muted">{t('vid.ed.manualOnly')}</p>
          {describeFile(job?.probe ?? null) && <p className="small">{t('vid.ed.fileFacts')}: {describeFile(job?.probe ?? null)}</p>}
          {video.suggested_post_time && <p className="small">{t('vid.ed.suggestedTime')}: {video.suggested_post_time}</p>}
          {!caption.trim() && <p className="muted small" role="note">{t('vid.ed.noCaption')}</p>}
          {picture && (
            <p className="notice" role="note" data-testid="picture-notice">{t('vid.ed.pictureNotice')}
              {typeof picture.dark_seconds === 'number' && <> ({t('vid.ed.darkStretch')}: {picture.dark_seconds} s, {picture.dark_start} s)</>}
              {picture.cover_dark === true && <> ({t('vid.ed.coverDark')})</>}
            </p>
          )}
          <div className="row">
            {files.video && <a className="btn btn-primary" href={files.video}>{t('vid.ed.downloadVideo')}</a>}
            {files.cover && <a className="btn" href={files.cover}>{t('vid.ed.downloadCover')}</a>}
            <button type="button" className="btn" onClick={() => void copyText()}>{t('vid.ed.copyText')}</button>
          </div>
          {actions.includes('markPublished') && (
            <div className="subcard">
              <label className="check"><input type="checkbox" checked={confirmPublished} onChange={(e) => setConfirmPublished(e.target.checked)} /> {t('vid.act.confirmPublished')}</label>
              <button type="button" className="btn btn-primary" disabled={busy || !confirmPublished} onClick={() => void run('markPublished')}>{t('vid.act.markPublished')}</button>
            </div>
          )}
        </section>
      )}

      {editable && (
        <section className="card quality" aria-labelledby="q-h">
          <h2 id="q-h">{t('vid.q.title')}</h2>
          <p className="muted small">{t('vid.q.intro')}</p>
          <QualityPanel report={video.quality_report as QualityReport | null} checkedAt={video.quality_checked_at}
            latestEdit={[video.updated_at, ...scenes.map((s) => s.updated_at)].sort().at(-1) ?? null} />
          <div className="row"><button type="button" className="btn" disabled={busy} onClick={() => void checkOnly()}>{t('vid.q.run')}</button></div>
        </section>
      )}

      <section className="card">
        <h2>{t('vid.ed.scenes')}</h2>
        <ol className="scenes">
          {drafts.map((d, i) => {
            const s = scenes[i]!;
            const img = s.image_path ? urls[s.image_path] : null;
            return (
              <li key={d.id} className="scene">
                <div className="scene-top">
                  {img ? <img className="scene-img" src={img} alt="" /> : <span className="scene-img none" aria-hidden="true" />}
                  <div className="chips">
                    <span className="chip">{i + 1}. {s.scene_type}</span>
                    <span className={`chip ${s.source.headline === 'typed' || s.source.body === 'typed' ? 'chip-warn' : 'chip-ok'}`}>
                      {s.source.headline === 'typed' || s.source.body === 'typed' ? t('vid.ed.typed') : t('vid.ed.fromCatalogue')}
                    </span>
                  </div>
                </div>
                <label className="field"><span>{t('vid.ed.headline')}</span>
                  <input value={d.headline} disabled={!editable} maxLength={200} onChange={(e) => setDraft(i, { headline: e.target.value })} />
                </label>
                <label className="field"><span>{t('vid.ed.body')}</span>
                  <textarea rows={2} value={d.body} disabled={!editable} maxLength={500} onChange={(e) => setDraft(i, { body: e.target.value })} />
                </label>
                <div className="two">
                  <div className="fieldwrap">
                    <label className="field"><span>{t('vid.ed.seconds')}</span>
                      <input inputMode="decimal" value={d.seconds} disabled={!editable} onChange={(e) => setDraft(i, { seconds: e.target.value })} aria-invalid={parsed[i] === null} />
                    </label>
                    {parsed[i] === null && <span className="error small" role="alert">{t('vid.ed.badSeconds')}</span>}
                  </div>
                  <label className="field"><span>{t('vid.ed.animation')}</span>
                    <select value={d.animation} disabled={!editable} onChange={(e) => setDraft(i, { animation: e.target.value as Animation })}>
                      {ANIMATIONS.map((a) => <option key={a} value={a}>{t(`vid.anim.${a}` as MessageKey)}</option>)}
                    </select>
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
        <p className={timeOk ? 'ok small' : 'error small'} role="status">
          {total / 1000} s / {video.duration_seconds} s — {timeOk ? t('vid.ed.timeOk') : t('vid.ed.timeOff')}
        </p>
        {editable && <button type="button" className="btn btn-primary" disabled={busy || !secondsOk} onClick={() => void saveScenes()}>{busy ? t('common.saving') : t('vid.ed.saveScenes')}</button>}
      </section>

      <section className="card">
        <h2>{t('vid.ed.details')}</h2>
        <label className="field"><span>{t('vid.ed.caption')}</span>
          <textarea rows={3} value={caption} disabled={!canWrite || video.status === 'archived'} maxLength={2200} onChange={(e) => setCaption(e.target.value)} />
        </label>
        <div className="fieldwrap">
          <label className="field"><span>{t('vid.ed.hashtags')}</span>
            <input value={tags} disabled={!canWrite || video.status === 'archived'} onChange={(e) => setTags(e.target.value)} aria-invalid={tagList === 'invalid'} />
          </label>
          {tagList === 'invalid' && <span className="error small" role="alert">{t('vid.ed.hashtagsBad')}</span>}
        </div>
        <label className="field"><span>{t('vid.ed.postTime')}</span>
          <input value={postTime} disabled={!canWrite || video.status === 'archived'} maxLength={120} onChange={(e) => setPostTime(e.target.value)} />
        </label>
        {canWrite && video.status !== 'archived' && video.status !== 'queued' && video.status !== 'rendering' && (
          <button type="button" className="btn" disabled={busy || tagList === 'invalid'} onClick={() => void saveDetails()}>{t('vid.ed.saveDetails')}</button>
        )}
      </section>

      {history.length > 0 && (
        <section className="card">
          <h2>{t('vid.ed.history')}</h2>
          <ul className="history">
            {history.map((h) => (
              <li key={h.id} className="small">
                {formatDate(h.at)} · {h.from_status ? `${t(`vid.status.${h.from_status}` as MessageKey)} → ` : ''}{t(`vid.status.${h.to_status}` as MessageKey)}{h.note ? ` — ${h.note}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
      {job && job.status === 'failed' && job.error_message && <p className="muted small">{job.error_message}</p>}
    </>
  );
}

function QualityPanel({ report, checkedAt, latestEdit }: { report: QualityReport | null; checkedAt: string | null; latestEdit: string | null }) {
  const { t } = useI18n();
  if (!report) return <p className="muted" data-testid="q-none">{t('vid.q.none')}</p>;
  const stale = !!checkedAt && !!latestEdit && new Date(latestEdit).getTime() > new Date(checkedAt).getTime() + 2000;
  const mark = (c: QualityCheck) => (c.status === 'pass' ? t('vid.q.ok') : c.status === 'warn' ? t('vid.q.w') : t('vid.q.f'));
  const word = (c: QualityCheck) => t(`vid.q.${c.status}` as MessageKey);
  const problems = report.checks.filter((c) => c.status !== 'pass').sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1));
  const passed = report.checks.filter((c) => c.status === 'pass');
  return (
    <div data-testid="q-report" data-status={report.status}>
      <p><strong>{t(`vid.q.${report.status}` as MessageKey)}</strong>{checkedAt && <span className="muted small"> · {t('vid.q.last')}: {new Date(checkedAt).toLocaleString()}</span>}</p>
      {stale && <p className="notice" role="note">{t('vid.q.stale')}</p>}
      {problems.length > 0 && (
        <ul className="qlist">
          {problems.map((c) => (
            <li key={c.id} className={`q-${c.status}`}>
              <span aria-hidden="true">{mark(c)}</span> <span className="sr-only">{word(c)}: </span>{t(`vid.q.c.${c.id}` as MessageKey)}
              {c.scenes && c.scenes.length > 0 && <span className="muted small"> ({t('vid.q.scenes')}: {c.scenes.join(', ')})</span>}
              {c.detail && c.status !== 'pass' && <span className="muted small"> [{c.detail}]</span>}
            </li>
          ))}
        </ul>
      )}
      {passed.length > 0 && (
        <details>
          <summary>{passed.length} {t('vid.q.passed')}</summary>
          <ul className="qlist">{passed.map((c) => <li key={c.id} className="q-pass"><span aria-hidden="true">{t('vid.q.ok')}</span> {t(`vid.q.c.${c.id}` as MessageKey)}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
