import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { canWriteCatalogue, videoEligible } from '../../lib/catalogue';
import { CTA_TYPES, type CtaType, type Lang, type VideoType } from '../../lib/scenes';
import { TEMPLATES, templatesFor, type TemplateId } from '../../lib/templates';
import { saveVideoDraft } from '../../lib/videoCreate';
import { checkFixQueue } from '../../lib/videoCheck';
import { BATCH_MAX, runBatch, type BatchOutcome } from '../../lib/batch';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';
import { useVideoCatalogue } from './useVideoCatalogue';

type ProductType = Extract<VideoType, 'product_showcase' | 'wholesale_offer'>;

/** Pick many approved products and make a draft video for each (optionally check and queue them). Nothing is published. */
export function BatchCreate() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const canWrite = canWriteCatalogue(profile);
  const { products, settings, loaded, loadFailed } = useVideoCatalogue();
  const [type, setType] = useState<ProductType>('product_showcase');
  const [templateId, setTemplateId] = useState<TemplateId | ''>('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [hasVideo, setHasVideo] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [results, setResults] = useState<BatchOutcome[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('video_projects').select('product_id, status').not('product_id', 'is', null).neq('status', 'archived').then(({ data }) => {
      setHasVideo(new Set(((data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id)));
    });
  }, [results]);

  const eligible = useMemo(() => products.filter(videoEligible), [products]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? eligible.filter((p) => p.name.toLowerCase().includes(s) || (p.brand ?? '').toLowerCase().includes(s)) : eligible;
  }, [eligible, q]);
  const templates = templatesFor(type);
  const tpl = TEMPLATES[(templateId || templates[0]!.id) as TemplateId];
  const saved = CTA_TYPES.find((c) => (settings[`cta_${c}`] ?? '').trim() !== '');
  const ctaType: CtaType = saved ?? 'whatsapp';
  const ctaValue = (settings[`cta_${ctaType}`] ?? '').trim();
  const lang: Lang = settings.default_language === 'am' || settings.default_language === 'so' ? settings.default_language : 'en';

  if (!canWrite) return <Navigate to="/videos" replace />;

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < BATCH_MAX) n.add(id); return n; });
  const selectNew = () => setPicked(new Set(shown.filter((p) => !hasVideo.has(p.id)).slice(0, BATCH_MAX).map((p) => p.id)));

  async function go(andQueue: boolean) {
    const db = supabase;
    if (!db || picked.size === 0 || !ctaValue) return;
    setBusy(true); setResults(null); setProgress([0, picked.size]);
    const chosen = eligible.filter((p) => picked.has(p.id));
    const res = await runBatch({
      products: chosen, type, language: lang, duration: tpl.defaultDuration, style: tpl.style, cta: { type: ctaType, value: ctaValue }, templateId: tpl.id,
      title: (p) => `${t(`vid.type.${type}` as MessageKey)}: ${p.name}`, andQueue,
      deps: { save: (a) => saveVideoDraft(db, a), finish: (id) => checkFixQueue(db, id) },
      onProgress: (d, n) => setProgress([d, n]),
    });
    setBusy(false); setProgress(null); setResults(res); setPicked(new Set());
  }

  const count = (s: BatchOutcome['status']) => results?.filter((r) => r.status === s).length ?? 0;

  return (
    <>
      <p><Link to="/videos">← {t('vid.back')}</Link></p>
      <h1>{t('batch.title')}</h1>
      <p className="muted">{t('batch.intro').replace('{n}', String(BATCH_MAX))}</p>
      {loadFailed && <p role="alert" className="error">{t('common.loadError')}</p>}
      {!loaded && !loadFailed && <p className="muted">{t('common.loading')}</p>}
      {loaded && (
        <div className="card wizard">
          <div className="two">
            <label className="field"><span>{t('vid.wiz.type')}</span>
              <select value={type} onChange={(e) => { setType(e.target.value as ProductType); setTemplateId(''); }}>
                <option value="product_showcase">{t('vid.type.product_showcase')}</option>
                <option value="wholesale_offer">{t('vid.type.wholesale_offer')}</option>
              </select>
            </label>
            <label className="field"><span>{t('vid.wiz.template')}</span>
              <select value={tpl.id} onChange={(e) => setTemplateId(e.target.value as TemplateId)}>
                {templates.map((tp) => <option key={tp.id} value={tp.id}>{t(`vid.tpl.${tp.id}` as MessageKey)} · {tp.defaultDuration} s</option>)}
              </select>
            </label>
          </div>
          {!ctaValue && <p role="alert" className="error">{t('vid.quick.noCta')} <Link to="/settings">{t('nav.settings')}</Link></p>}
          <label className="field"><span>{t('batch.search')}</span><input value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} /></label>
          <div className="row">
            <button type="button" className="btn" onClick={selectNew}>{t('batch.selectNew')}</button>
            <button type="button" className="btn" onClick={() => setPicked(new Set())}>{t('batch.clear')}</button>
            <span className="muted small">{t('batch.picked').replace('{n}', String(picked.size)).replace('{max}', String(BATCH_MAX))}</span>
          </div>
          {eligible.length === 0 && <p className="muted">{t('vid.wiz.noneEligible')}</p>}
          <ul className="history" aria-label={t('batch.list')}>
            {shown.map((p) => (
              <li key={p.id}>
                <label className="check">
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} disabled={busy || (!picked.has(p.id) && picked.size >= BATCH_MAX)} /> {p.name}
                </label>
                {hasVideo.has(p.id) && <span className="chip chip-warn"> {t('batch.hasVideo')}</span>}
              </li>
            ))}
          </ul>
          <p className="muted small">{t('batch.note')}</p>
          <div className="row">
            <button type="button" className="btn btn-primary big" disabled={busy || picked.size === 0 || !ctaValue} onClick={() => void go(true)}>
              {t('batch.createQueue').replace('{n}', String(picked.size))}
            </button>
            <button type="button" className="btn big" disabled={busy || picked.size === 0 || !ctaValue} onClick={() => void go(false)}>
              {t('batch.createDrafts').replace('{n}', String(picked.size))}
            </button>
          </div>
          {progress && <p role="status" className="muted">{t('batch.working').replace('{d}', String(progress[0])).replace('{n}', String(progress[1]))}</p>}
        </div>
      )}
      {results && (
        <section className="card" data-testid="batch-results" aria-live="polite">
          <h2>{t('batch.done')}</h2>
          <p>{t('batch.summary').replace('{q}', String(count('queued'))).replace('{d}', String(count('draft'))).replace('{s}', String(count('skipped') + count('error')))}</p>
          <ul className="history">
            {results.map((r) => (
              <li key={r.productId}>
                {r.videoId ? <Link to={`/videos/${r.videoId}`}>{r.name}</Link> : r.name} · {t(`batch.status.${r.status}` as MessageKey)}
                {r.reasonKey && <span className="muted small"> — {t(r.reasonKey as MessageKey)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
