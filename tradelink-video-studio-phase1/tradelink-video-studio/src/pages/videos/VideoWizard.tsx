import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { canWriteCatalogue, videoEligible, type Product } from '../../lib/catalogue';
import { CTA_TYPES, DURATIONS, STYLES, VIDEO_TYPES, type CtaType, type Duration, type Lang, type Style, type VideoType } from '../../lib/scenes';
import { TEMPLATES, templateFits, templatesFor, type TemplateId } from '../../lib/templates';
import { buildPlan, saveVideoDraft } from '../../lib/videoCreate';
import { useVideoCatalogue } from './useVideoCatalogue';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';

export function VideoWizard() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { profile } = useAuth();
  const canWrite = canWriteCatalogue(profile);
  const { products, suppliers, campaigns, campaignLinks, consented, settings, loaded, loadFailed, reload: load } = useVideoCatalogue();

  const [type, setType] = useState<VideoType>('product_showcase');
  const [subjectId, setSubjectId] = useState('');
  const [language, setLanguage] = useState<Lang>('en');
  const [duration, setDuration] = useState<Duration>(20);
  const [style, setStyle] = useState<Style>('premium');
  const [ctaType, setCtaType] = useState<CtaType>('whatsapp');
  const [ctaValue, setCtaValue] = useState('');
  const [ctaTouched, setCtaTouched] = useState(false);
  const [templateId, setTemplateId] = useState<TemplateId | ''>('');
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [consentNote, setConsentNote] = useState('');
  const [consentDate, setConsentDate] = useState('');

  // Prefill the call to action from Settings until the editor types their own.
  useEffect(() => {
    if (!ctaTouched) setCtaValue(settings[`cta_${ctaType}`] ?? '');
  }, [ctaType, settings, ctaTouched]);
  useEffect(() => { setSubjectId(''); setProblem(null); setTemplateId(''); }, [type]);

  const eligible = useMemo(() => products.filter(videoEligible), [products]);
  const subject = useMemo(() => {
    if (type === 'supplier_spotlight') return suppliers.find((x) => x.id === subjectId) ?? null;
    if (type === 'campaign_promotion') return campaigns.find((x) => x.id === subjectId) ?? null;
    return eligible.find((x) => x.id === subjectId) ?? null;
  }, [type, subjectId, suppliers, campaigns, eligible]);
  const options: Array<{ id: string; name: string }> =
    type === 'supplier_spotlight' ? suppliers : type === 'campaign_promotion' ? campaigns : eligible;
  const needsConsent = type === 'supplier_spotlight' && subjectId !== '' && !consented.has(subjectId);

  if (!canWrite) return <Navigate to="/videos" replace />;

  async function recordConsent() {
    if (!supabase || !subjectId || !consentNote.trim() || !consentDate) return;
    setBusy(true);
    const { error: err } = await supabase.from('supplier_consents').insert({ supplier_id: subjectId, note: consentNote.trim(), given_on: consentDate });
    setBusy(false);
    if (err) return setError(true);
    setError(false); setConsentNote(''); setConsentDate('');
    await load();
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !subject) return setProblem('vid.problem.noSubject');
    const plan = buildPlan({
      type, language, duration, style, cta: { type: ctaType, value: ctaValue }, templateId: templateId || null,
      subject, consented: consented.has(subjectId),
      campaignProducts: type === 'campaign_promotion'
        ? campaignLinks.filter((l) => l.campaign_id === subjectId).map((l) => products.find((p) => p.id === l.product_id)).filter((p): p is Product => !!p)
        : [],
    });
    if (!plan.ok) return setProblem(`vid.problem.${plan.problem}` as MessageKey);
    setProblem(null); setError(false); setBusy(true);
    const id = await saveVideoDraft(supabase, {
      type, language, duration, style, cta: { type: ctaType, value: ctaValue }, templateId: templateId || null,
      subject, consented: consented.has(subjectId), campaignProducts: [],
      title: `${t(`vid.type.${type}` as MessageKey)}: ${subject.name}`, subjectId, scenes: plan.scenes,
    });
    if (!id) { setBusy(false); return setError(true); }
    nav(`/videos/${id}`);
  }

  const subjectLabel = type === 'supplier_spotlight' ? 'vid.wiz.supplier' : type === 'campaign_promotion' ? 'vid.wiz.campaign' : 'vid.wiz.product';

  return (
    <>
      <p><Link to="/videos">← {t('vid.back')}</Link></p>
      <h1>{t('vid.wiz.title')}</h1>
      {loadFailed && <p role="alert" className="error">{t('common.loadError')}</p>}
      {!loaded && !loadFailed && <p className="muted">{t('common.loading')}</p>}
      {loaded && (
        <form className="card wizard" onSubmit={create} noValidate>
          <label className="field"><span>{t('vid.wiz.type')}</span>
            <select value={type} onChange={(e) => setType(e.target.value as VideoType)}>
              {VIDEO_TYPES.map((v) => <option key={v} value={v}>{t(`vid.type.${v}` as MessageKey)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('vid.wiz.template')}</span>
            <select value={templateId} onChange={(e) => {
              const id = e.target.value as TemplateId | '';
              setTemplateId(id);
              if (id) {
                const tpl = TEMPLATES[id];
                setStyle(tpl.style);
                if (!templateFits(id, type, duration)) setDuration(tpl.defaultDuration);
              }
            }}>
              <option value="">{t('vid.wiz.noTemplate')}</option>
              {templatesFor(type).map((tp) => <option key={tp.id} value={tp.id}>{t(`vid.tpl.${tp.id}` as MessageKey)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t(subjectLabel)}</span>
            <select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setProblem(null); }}>
              <option value="">{t('vid.wiz.choose')}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          {options.length === 0 && <p className="muted small">{t('vid.wiz.noneEligible')}</p>}

          {needsConsent && (
            <fieldset className="subcard">
              <legend>{t('vid.wiz.consentTitle')}</legend>
              <p className="muted small">{t('vid.wiz.consentBody')}</p>
              <label className="field"><span>{t('vid.wiz.consentNote')}</span><input value={consentNote} onChange={(e) => setConsentNote(e.target.value)} maxLength={500} /></label>
              <label className="field"><span>{t('vid.wiz.consentDate')}</span><input type="date" value={consentDate} onChange={(e) => setConsentDate(e.target.value)} /></label>
              <button type="button" className="btn" disabled={busy || !consentNote.trim() || !consentDate} onClick={() => void recordConsent()}>{t('vid.wiz.consentSave')}</button>
            </fieldset>
          )}

          <div className="two">
            <label className="field"><span>{t('vid.wiz.language')}</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
                <option value="en">{t('lang.en')}</option><option value="am">{t('lang.am')}</option><option value="so">{t('lang.so')}</option>
              </select>
            </label>
            <label className="field"><span>{t('vid.wiz.length')}</span>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value) as Duration)}>
                {DURATIONS.map((d) => <option key={d} value={d}>{d} s</option>)}
              </select>
            </label>
          </div>
          <label className="field"><span>{t('vid.wiz.style')}</span>
            <select value={style} onChange={(e) => setStyle(e.target.value as Style)}>
              {STYLES.map((s) => <option key={s} value={s}>{t(`vid.style.${s}` as MessageKey)}</option>)}
            </select>
          </label>
          <div className="two">
            <label className="field"><span>{t('vid.wiz.cta')}</span>
              <select value={ctaType} onChange={(e) => { setCtaType(e.target.value as CtaType); setCtaTouched(false); }}>
                {CTA_TYPES.map((c) => <option key={c} value={c}>{t(`vid.cta.${c}` as MessageKey)}</option>)}
              </select>
            </label>
            <label className="field"><span>{t('vid.wiz.ctaValue')}</span>
              <input value={ctaValue} onChange={(e) => { setCtaValue(e.target.value); setCtaTouched(true); }} maxLength={200} />
            </label>
          </div>
          <p className="muted small">{t('vid.wiz.ctaHint')}</p>

          {problem && <p role="alert" className="error">{t(problem)}</p>}
          {error && <p role="alert" className="error">{t('common.saveError')}</p>}
          <button type="submit" className="btn btn-primary big" disabled={busy}>{busy ? t('common.saving') : t('vid.wiz.create')}</button>
        </form>
      )}
    </>
  );
}
