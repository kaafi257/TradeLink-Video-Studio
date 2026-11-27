import { useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { canWriteCatalogue, videoEligible, type Product } from '../../lib/catalogue';
import { CTA_TYPES, VIDEO_TYPES, type CtaType, type Lang, type VideoType } from '../../lib/scenes';
import { TEMPLATES, templatesFor, type TemplateId } from '../../lib/templates';
import { buildPlan, draftCopy, saveVideoDraft } from '../../lib/videoCreate';
import { checkFixQueue } from '../../lib/videoCheck';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';
import { useVideoCatalogue } from './useVideoCatalogue';

/** One-click draft: pick what to promote and a template. Everything else comes from the template and Settings. Stops at Draft. */
export function QuickCreate() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { profile } = useAuth();
  const canWrite = canWriteCatalogue(profile);
  const { products, suppliers, campaigns, campaignLinks, consented, settings, loaded, loadFailed } = useVideoCatalogue();

  const [type, setType] = useState<VideoType>('product_showcase');
  const [subjectId, setSubjectId] = useState('');
  const [templateId, setTemplateId] = useState<TemplateId | ''>('');
  const [ctaType, setCtaType] = useState<CtaType | ''>('');
  const [ctaValue, setCtaValue] = useState('');
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const eligible = useMemo(() => products.filter(videoEligible), [products]);
  const options: Array<{ id: string; name: string }> = type === 'supplier_spotlight' ? suppliers : type === 'campaign_promotion' ? campaigns : eligible;
  const templates = templatesFor(type);
  const tpl = TEMPLATES[(templateId || templates[0]!.id) as TemplateId];

  // Contact: the first one saved in Settings, unless the user picks another.
  const saved = CTA_TYPES.find((c) => (settings[`cta_${c}`] ?? '').trim() !== '');
  const effType: CtaType = (ctaType || saved || 'whatsapp') as CtaType;
  const effValue = ctaValue !== '' ? ctaValue : (settings[`cta_${effType}`] ?? '');
  const lang: Lang = settings.default_language === 'am' || settings.default_language === 'so' ? settings.default_language : 'en';

  if (!canWrite) return <Navigate to="/videos" replace />;

  async function create(e: FormEvent | null, andQueue = false) {
    e?.preventDefault();
    const subject = type === 'supplier_spotlight' ? suppliers.find((x) => x.id === subjectId)
      : type === 'campaign_promotion' ? campaigns.find((x) => x.id === subjectId) : eligible.find((x) => x.id === subjectId);
    if (!supabase || !subject) return setProblem('vid.problem.noSubject');
    const args = {
      type, language: lang, duration: tpl.defaultDuration, style: tpl.style, cta: { type: effType, value: effValue }, templateId: tpl.id,
      subject, consented: consented.has(subjectId),
      campaignProducts: type === 'campaign_promotion'
        ? campaignLinks.filter((l) => l.campaign_id === subjectId).map((l) => products.find((p) => p.id === l.product_id)).filter((p): p is Product => !!p)
        : [],
    };
    const plan = buildPlan(args);
    if (!plan.ok) return setProblem(`vid.problem.${plan.problem}` as MessageKey);
    setProblem(null); setError(false); setBusy(true);
    const copy = await draftCopy(args, plan.scenes);
    const id = await saveVideoDraft(supabase, {
      ...args, title: `${t(`vid.type.${type}` as MessageKey)}: ${subject.name}`, subjectId, scenes: plan.scenes, copy,
    });
    if (!id) { setBusy(false); return setError(true); }
    if (andQueue) {
      const out = await checkFixQueue(supabase, id);
      nav(`/videos/${id}`, { state: { queueResult: out.kind } });
      return;
    }
    nav(`/videos/${id}`);
  }

  const subjectLabel = type === 'supplier_spotlight' ? 'vid.wiz.supplier' : type === 'campaign_promotion' ? 'vid.wiz.campaign' : 'vid.wiz.product';

  return (
    <>
      <p><Link to="/videos">← {t('vid.back')}</Link></p>
      <h1>{t('vid.quick.title')}</h1>
      <p className="muted">{t('vid.quick.intro')}</p>
      {loadFailed && <p role="alert" className="error">{t('common.loadError')}</p>}
      {!loaded && !loadFailed && <p className="muted">{t('common.loading')}</p>}
      {loaded && (
        <form className="card wizard" onSubmit={(e) => void create(e)} noValidate>
          <label className="field"><span>{t('vid.wiz.type')}</span>
            <select value={type} onChange={(e) => { setType(e.target.value as VideoType); setSubjectId(''); setTemplateId(''); setProblem(null); }}>
              {VIDEO_TYPES.map((v) => <option key={v} value={v}>{t(`vid.type.${v}` as MessageKey)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t(subjectLabel)}</span>
            <select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setProblem(null); }}>
              <option value="">{t('vid.wiz.choose')}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          {options.length === 0 && <p className="muted small">{t('vid.wiz.noneEligible')}</p>}
          <fieldset className="field tpl-pick">
            <legend>{t('vid.wiz.template')}</legend>
            {templates.map((tp) => (
              <label key={tp.id} className="check">
                <input type="radio" name="tpl" checked={tpl.id === tp.id} onChange={() => setTemplateId(tp.id)} /> {t(`vid.tpl.${tp.id}` as MessageKey)} · {tp.defaultDuration} s
              </label>
            ))}
          </fieldset>
          {!saved && <p className="muted small">{t('vid.quick.noCta')}</p>}
          <div className="two">
            <label className="field"><span>{t('vid.wiz.cta')}</span>
              <select value={effType} onChange={(e) => { setCtaType(e.target.value as CtaType); setCtaValue(''); }}>
                {CTA_TYPES.map((c) => <option key={c} value={c}>{t(`vid.cta.${c}` as MessageKey)}</option>)}
              </select>
            </label>
            <label className="field"><span>{t('vid.wiz.ctaValue')}</span>
              <input value={effValue} onChange={(e) => setCtaValue(e.target.value)} maxLength={200} />
            </label>
          </div>
          <p className="muted small">{t('vid.quick.summary')}</p>
          <p className="muted small">{t('vid.quick.stops')}</p>
          <p className="muted small">{t('vid.quick.queueNote')}</p>
          {problem && <p role="alert" className="error">{t(problem)}{problem === 'vid.problem.needsConsent' && <> <Link to="/videos/new">{t('vid.quick.more')}</Link></>}</p>}
          {error && <p role="alert" className="error">{t('common.saveError')}</p>}
          <div className="row">
            <button type="button" className="btn btn-primary big" disabled={busy} onClick={() => void create(null, true)}>{busy ? t('common.saving') : t('vid.quick.createQueue')}</button>
            <button type="submit" className="btn big" disabled={busy}>{t('vid.quick.create')}</button>
            <Link className="btn" to="/videos/new">{t('vid.quick.more')}</Link>
          </div>
        </form>
      )}
    </>
  );
}
