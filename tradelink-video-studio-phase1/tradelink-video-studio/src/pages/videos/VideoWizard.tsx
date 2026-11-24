import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { canWriteCatalogue, videoEligible, type Campaign, type Product, type Supplier } from '../../lib/catalogue';
import { CTA_TYPES, DURATIONS, STYLES, VIDEO_TYPES, generateScenes, type CtaType, type Duration, type Lang, type Style, type VideoType } from '../../lib/scenes';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';

type Settings = Partial<Record<`cta_${CtaType}`, string | null>>;

export function VideoWizard() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { profile } = useAuth();
  const canWrite = canWriteCatalogue(profile);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignLinks, setCampaignLinks] = useState<Array<{ campaign_id: string; product_id: string }>>([]);
  const [consented, setConsented] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Settings>({});
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const [type, setType] = useState<VideoType>('product_showcase');
  const [subjectId, setSubjectId] = useState('');
  const [language, setLanguage] = useState<Lang>('en');
  const [duration, setDuration] = useState<Duration>(20);
  const [style, setStyle] = useState<Style>('premium');
  const [ctaType, setCtaType] = useState<CtaType>('whatsapp');
  const [ctaValue, setCtaValue] = useState('');
  const [ctaTouched, setCtaTouched] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [consentNote, setConsentNote] = useState('');
  const [consentDate, setConsentDate] = useState('');

  async function load() {
    if (!supabase) return;
    const [p, s, c, cp, sc, st] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('campaigns').select('*').order('name'),
      supabase.from('campaign_products').select('campaign_id, product_id'),
      supabase.from('supplier_consents').select('supplier_id, withdrawn'),
      supabase.from('app_settings').select('cta_whatsapp, cta_telegram, cta_phone, cta_website').maybeSingle(),
    ]);
    if (p.error || s.error || c.error || cp.error || sc.error) return setLoadFailed(true);
    setProducts((p.data ?? []) as Product[]);
    setSuppliers(((s.data ?? []) as Supplier[]).filter((x) => x.active));
    setCampaigns(((c.data ?? []) as Campaign[]).filter((x) => x.active));
    setCampaignLinks((cp.data ?? []) as Array<{ campaign_id: string; product_id: string }>);
    setConsented(new Set(((sc.data ?? []) as Array<{ supplier_id: string; withdrawn: boolean }>).filter((r) => !r.withdrawn).map((r) => r.supplier_id)));
    setSettings((st.data ?? {}) as Settings);
    setLoaded(true);
  }
  useEffect(() => { void load(); }, []);

  // Prefill the call to action from Settings until the editor types their own.
  useEffect(() => {
    if (!ctaTouched) setCtaValue(settings[`cta_${ctaType}`] ?? '');
  }, [ctaType, settings, ctaTouched]);
  useEffect(() => { setSubjectId(''); setProblem(null); }, [type]);

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
    const plan = generateScenes({
      type, language, duration, style, cta: { type: ctaType, value: ctaValue },
      product: type === 'product_showcase' || type === 'wholesale_offer' ? (subject as Product) : null,
      supplier: type === 'supplier_spotlight' ? (subject as Supplier) : null,
      campaign: type === 'campaign_promotion' ? (subject as Campaign) : null,
      supplierConsent: consented.has(subjectId),
      campaignProducts: type === 'campaign_promotion'
        ? campaignLinks.filter((l) => l.campaign_id === subjectId).map((l) => products.find((p) => p.id === l.product_id)).filter((p): p is Product => !!p)
        : [],
    });
    if (!plan.ok) return setProblem(`vid.problem.${plan.problem}` as MessageKey);
    setProblem(null); setError(false); setBusy(true);
    const { data, error: e1 } = await supabase.from('video_projects').insert({
      title: `${t(`vid.type.${type}` as MessageKey)}: ${subject.name}`.slice(0, 160), video_type: type,
      product_id: type === 'product_showcase' || type === 'wholesale_offer' ? subjectId : null,
      supplier_id: type === 'supplier_spotlight' ? subjectId : null,
      campaign_id: type === 'campaign_promotion' ? subjectId : null,
      language, duration_seconds: duration, style, cta_type: ctaType, cta_value: ctaValue.trim(),
    }).select('id').single();
    if (e1 || !data) { setBusy(false); return setError(true); }
    const id = (data as { id: string }).id;
    const { error: e2 } = await supabase.from('video_scenes').insert(plan.scenes.map((s) => ({ ...s, project_id: id })));
    if (e2) {
      await supabase.from('video_projects').delete().eq('id', id); // no half-made video is left behind
      setBusy(false);
      return setError(true);
    }
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
                <option value="en">{t('lang.en')}</option><option value="am">{t('lang.am')}</option>
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
