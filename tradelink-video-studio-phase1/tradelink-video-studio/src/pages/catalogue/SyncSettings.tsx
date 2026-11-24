import { useI18n } from '../../i18n/i18n';

// Interface only. Nothing on this page makes any request, and no marketplace credentials exist in the Studio.
export function SyncSettings() {
  const { t } = useI18n();
  const rows: Array<[string, string]> = [
    ['sync.status', 'sync.notConnected'],
    ['sync.last', 'sync.unavailable'],
    ['sync.auto', 'sync.disabled'],
  ];
  return (
    <div className="stack">
      <section className="card">
        <h2>{t('sync.title')}</h2>
        <dl className="facts">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="muted">{t(k as 'sync.status')}</dt>
              <dd>{t(v as 'sync.disabled')}</dd>
            </div>
          ))}
        </dl>
        <p>
          <button type="button" className="btn" disabled>{t('sync.manual')}</button>
        </p>
        <p className="muted">{t('sync.explain')}</p>
      </section>
      <section className="card">
        <h2>{t('sync.history')}</h2>
        <p className="muted">{t('sync.empty')}</p>
      </section>
    </div>
  );
}
