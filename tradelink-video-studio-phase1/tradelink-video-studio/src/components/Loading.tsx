import { useI18n } from '../i18n/i18n';

/** Loading placeholder: the word "Loading…" for screen readers and a few shimmering bars so the page does not look empty. */
export function Loading() {
  const { t } = useI18n();
  return (
    <div role="status" aria-busy="true" className="loading-box">
      <p className="muted">{t('common.loading')}</p>
      <span className="skeleton" style={{ width: '60%' }} />
      <span className="skeleton" style={{ width: '90%' }} />
      <span className="skeleton" style={{ width: '75%' }} />
    </div>
  );
}
