import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { canEditSettings } from '../lib/roles';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

const TEXT_FIELDS = [
  ['brand_name', 'settings.brandName'],
  ['site_address', 'settings.siteAddress'],
  ['tiktok_handle', 'settings.tiktokHandle'],
  ['cta_whatsapp', 'settings.ctaWhatsapp'],
  ['cta_telegram', 'settings.ctaTelegram'],
  ['cta_phone', 'settings.ctaPhone'],
  ['cta_website', 'settings.ctaWebsite'],
] as const satisfies ReadonlyArray<readonly [string, MessageKey]>;

type TextField = (typeof TEXT_FIELDS)[number][0];
type Values = Record<TextField, string> & { default_language: '' | 'en' | 'am' };

const EMPTY: Values = {
  brand_name: '',
  site_address: '',
  tiktok_handle: '',
  cta_whatsapp: '',
  cta_telegram: '',
  cta_phone: '',
  cta_website: '',
  default_language: '',
};

export function Settings() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const editable = canEditSettings(profile);
  const [values, setValues] = useState<Values>(EMPTY);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from('app_settings')
      .select('brand_name, site_address, tiktok_handle, default_language, cta_whatsapp, cta_telegram, cta_phone, cta_website')
      .eq('id', true)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const next: Values = { ...EMPTY };
        for (const [field] of TEXT_FIELDS) next[field] = (data[field] as string | null) ?? '';
        next.default_language = (data.default_language as Values['default_language'] | null) ?? '';
        setValues(next);
      });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !editable) return;
    setStatus('idle');
    const payload: Record<string, string | null> = {};
    for (const [field] of TEXT_FIELDS) payload[field] = values[field].trim() || null;
    payload.default_language = values.default_language || null;
    const { error } = await supabase.from('app_settings').update(payload).eq('id', true);
    setStatus(error ? 'error' : 'saved');
  }

  return (
    <>
      <h1>{t('settings.title')}</h1>
      {!editable && <p className="muted">{t('settings.readOnly')}</p>}
      <form onSubmit={(e) => void onSubmit(e)} className="card stack">
        {TEXT_FIELDS.map(([field, label]) => (
          <label key={field} className="field">
            <span>{t(label)}</span>
            <input
              type="text"
              maxLength={200}
              disabled={!editable}
              value={values[field]}
              onChange={(e) => setValues({ ...values, [field]: e.target.value })}
            />
          </label>
        ))}
        <label className="field">
          <span>{t('settings.defaultLanguage')}</span>
          <select
            disabled={!editable}
            value={values.default_language}
            onChange={(e) =>
              setValues({ ...values, default_language: e.target.value as Values['default_language'] })
            }
          >
            <option value="">{t('settings.langUnset')}</option>
            <option value="en">{t('lang.en')}</option>
            <option value="am">{t('lang.am')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('settings.timezone')}</span>
          <input type="text" value="Africa/Addis_Ababa" disabled readOnly />
        </label>
        {status === 'saved' && <p role="status">{t('settings.saved')}</p>}
        {status === 'error' && (
          <p className="error" role="alert">
            {t('settings.error')}
          </p>
        )}
        {editable && (
          <button type="submit" className="btn btn-primary">
            {t('settings.save')}
          </button>
        )}
      </form>
    </>
  );
}
