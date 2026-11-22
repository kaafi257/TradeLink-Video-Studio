import { useI18n } from '../i18n/i18n';

// Phase 1: status cards only. No numbers, products or content are invented.
export function Dashboard() {
  const { t } = useI18n();
  const cards = [
    { title: t('dash.catalogue'), body: t('dash.catalogueStatus') },
    { title: t('dash.videos'), body: t('dash.videosStatus') },
    { title: t('dash.planner'), body: t('dash.plannerStatus') },
  ];
  return (
    <>
      <h1>{t('dash.title')}</h1>
      <div className="grid">
        {cards.map((c) => (
          <section key={c.title} className="card">
            <h2>{c.title}</h2>
            <p className="muted">{c.body}</p>
          </section>
        ))}
      </div>
    </>
  );
}
