import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { buildFacts, rulesProvider, runCopy, type CopyRequest, type CopyResult, type CopySource } from '../../lib/copy';
import { cancelCopyJob, GIVE_UP_MS, guardLocalResult, HINT_AFTER_MS, POLL_MS, readCopyJob, requestLocalCopy } from '../../lib/localAi';
import type { Cta, VideoType } from '../../lib/scenes';
import type { VideoProject, VideoSceneRow } from '../../lib/videos';
import { useI18n } from '../../i18n/i18n';

export interface Suggestion { result: CopyResult; source: CopySource; dropped: string[]; model?: string | null }
type Scope = 'all' | 'caption' | 'scene';

/** Suggested wording: rules (instant) or optional local AI. Nothing is applied or saved until the person clicks Apply. */
export function SuggestPanel({ video, scenes, onApply, disabled }: {
  video: VideoProject; scenes: VideoSceneRow[]; disabled: boolean; onApply: (s: Suggestion, scope: Scope, scene: number | null) => void;
}) {
  const { t } = useI18n();
  const [scope, setScope] = useState<Scope>('all');
  const [scene, setScene] = useState(1);
  const [sug, setSug] = useState<Suggestion | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<{ id: string; since: number } | null>(null);
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; if (timer.current) window.clearTimeout(timer.current); }, []);

  async function request(): Promise<CopyRequest | null> {
    if (!supabase) return null;
    const prod = video.video_type === 'product_showcase' || video.video_type === 'wholesale_offer';
    const [pr, su, ca] = await Promise.all([
      prod && video.product_id ? supabase.from('products').select('*').eq('id', video.product_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      video.supplier_id ? supabase.from('suppliers').select('*').eq('id', video.supplier_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      video.campaign_id ? supabase.from('campaigns').select('*').eq('id', video.campaign_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (pr.error || su.error || ca.error) return null;
    const cta = { type: video.cta_type, value: video.cta_value } as Cta;
    const facts = buildFacts({ type: video.video_type as VideoType, language: video.language, cta, product: pr.data as never, supplier: su.data as never, campaign: ca.data as never });
    return {
      facts, scope, ...(scope === 'scene' ? { scenePosition: scene } : {}),
      scenes: scenes.map((s) => ({ position: s.position, scene_type: s.scene_type, headline: s.headline, body: s.body })),
    };
  }

  function show(s: Suggestion) {
    setSug(s);
    const none = !s.result.caption && !(s.result.hashtags?.length) && s.result.scenes.length === 0;
    setNote(none ? t('vid.sug.nothing') : null);
  }

  async function suggestRules() {
    setBusy(true); setError(null); setSug(null);
    const req = await request();
    if (!req) { setBusy(false); return setError(t('vid.sug.error')); }
    const r = await runCopy(rulesProvider, req);
    setBusy(false);
    if (!r.ok) return setError(t('vid.sug.error'));
    show({ result: r.result, source: 'rules', dropped: r.dropped });
  }

  function stopWaiting() { if (timer.current) window.clearTimeout(timer.current); setWaiting(null); setSlow(false); }

  async function suggestAi() {
    if (!supabase) return;
    setBusy(true); setError(null); setSug(null);
    const req = await request();
    const made = req ? await requestLocalCopy(supabase, video.id, scope, scope === 'scene' ? scene : null) : { error: 'x' };
    setBusy(false);
    if (!req || !made.id) return setError(made.error && /Too many/i.test(made.error) ? t('vid.sug.rate') : t('vid.sug.error'));
    const since = Date.now();
    setWaiting({ id: made.id, since });
    const poll = async () => {
      if (!alive.current || !supabase) return;
      const row = await readCopyJob(supabase, made.id!);
      if (!alive.current) return;
      if (row && (row.status === 'succeeded' || row.status === 'failed' || row.status === 'cancelled')) {
        setWaiting(null); setSlow(false);
        if (row.status === 'cancelled') return;
        if (row.status === 'failed') return setError(`${t('vid.sug.aiFailed')}${row.error_message ? ` (${row.error_message})` : ''}`);
        const g = await guardLocalResult(row.result, req);
        if (!g.ok) return setError(t('vid.sug.error'));
        return show({ result: g.result, source: 'local_ai', dropped: g.dropped, model: row.model });
      }
      const waited = Date.now() - since;
      if (waited > GIVE_UP_MS) { setWaiting(null); setSlow(false); return setError(t('vid.sug.timeout')); }
      setSlow(waited > HINT_AFTER_MS);
      timer.current = window.setTimeout(() => void poll(), POLL_MS);
    };
    timer.current = window.setTimeout(() => void poll(), POLL_MS);
  }

  async function cancel() {
    if (!supabase || !waiting) return;
    await cancelCopyJob(supabase, waiting.id);
    stopWaiting();
  }

  const names = new Map(scenes.map((s) => [s.position, `${s.position}. ${s.scene_type}`]));
  return (
    <section className="card suggest" aria-labelledby="sug-h" data-testid="suggest-panel">
      <h2 id="sug-h">{t('vid.sug.title')}</h2>
      <p className="muted small">{t('vid.sug.intro')}</p>
      {video.language !== 'en' && <p className="notice small" role="note">{t('vid.sug.draft')}</p>}
      <div className="two">
        <label className="field"><span>{t('vid.sug.scope')}</span>
          <select value={scope} disabled={disabled || !!waiting} onChange={(e) => setScope(e.target.value as Scope)}>
            <option value="all">{t('vid.sug.scopeAll')}</option>
            <option value="caption">{t('vid.sug.scopeCaption')}</option>
            <option value="scene">{t('vid.sug.scopeScene')}</option>
          </select>
        </label>
        {scope === 'scene' && (
          <label className="field"><span>{t('vid.sug.which')}</span>
            <select value={scene} disabled={disabled || !!waiting} onChange={(e) => setScene(Number(e.target.value))}>
              {scenes.map((s) => <option key={s.id} value={s.position}>{names.get(s.position)}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn" disabled={disabled || busy || !!waiting} onClick={() => void suggestRules()}>{t('vid.sug.rules')}</button>
        <button type="button" className="btn" disabled={disabled || busy || !!waiting} onClick={() => void suggestAi()}>{t('vid.sug.ai')}</button>
      </div>
      <p className="muted small">{t('vid.sug.aiNote')}</p>
      {waiting && (
        <div role="status" className="subcard" data-testid="suggest-waiting">
          <p>{t('vid.sug.waiting')}</p>
          {slow && <p className="muted small">{t('vid.sug.slow')}</p>}
          <button type="button" className="btn" onClick={() => void cancel()}>{t('vid.sug.cancel')}</button>
        </div>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {sug && (
        <div className="subcard" data-testid="suggest-result">
          <h3>{sug.source === 'local_ai' ? t('vid.sug.fromAi') : t('vid.sug.fromRules')}{sug.model ? ` (${sug.model})` : ''}</h3>
          {note && <p className="muted">{note}</p>}
          {sug.result.scenes.map((s) => (
            <p key={s.position} className="small"><strong>{names.get(s.position) ?? s.position}</strong>{s.headline !== undefined && <> {s.headline}</>}{s.body !== undefined && <> — {s.body}</>}</p>
          ))}
          {sug.result.caption && <p className="small"><strong>{t('vid.ed.caption')}:</strong> {sug.result.caption}</p>}
          {!!sug.result.hashtags?.length && <p className="small"><strong>{t('vid.ed.hashtags')}:</strong> {sug.result.hashtags.map((h) => `#${h}`).join(' ')}</p>}
          {sug.dropped.length > 0 && <p className="muted small" role="note">{t('vid.sug.dropped')} {sug.dropped.length}</p>}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={!!note} onClick={() => { onApply(sug, scope, scope === 'scene' ? scene : null); setSug(null); }}>{t('vid.sug.apply')}</button>
            <button type="button" className="btn" onClick={() => setSug(null)}>{t('vid.sug.discard')}</button>
          </div>
          <p className="muted small">{t('vid.sug.applyNote')}</p>
        </div>
      )}
    </section>
  );
}
