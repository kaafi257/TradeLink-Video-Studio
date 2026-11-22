import { useI18n, type Lang } from '../i18n/i18n';

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <label className="lang-switch">
      <span>{t('lang.label')}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        <option value="en">{t('lang.en')}</option>
        <option value="am">{t('lang.am')}</option>
      </select>
    </label>
  );
}
