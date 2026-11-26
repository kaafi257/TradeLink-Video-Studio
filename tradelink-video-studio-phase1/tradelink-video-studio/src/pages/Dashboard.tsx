import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/i18n';
import { useAuth } from '../lib/auth';
import { canWriteCatalogue } from '../lib/catalogue';
import { IconBolt, IconBox, IconFilm } from '../components/icons';

// Status cards only. No numbers, products or content are invented.
export function Dashboard() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const canWrite = canWriteCatalogue(profile);
  const cards = [
    { to: '/catalogue', icon: <IconBox />, title: t('dash.catalogue'), body: t('dash.catalogueStatus') },
    { to: '/videos', icon: <IconFilm />, title: t('dash.videos'), body: t('dash.videosStatus') },
  ];
  return (
    <>
      <section className="hero">
        <div>
          <h1>{t('dash.title')}</h1>
          <p>{t('dash.welcome')}</p>
        </div>
        {canWrite && (
          <Link className="btn btn-primary big" to="/videos/quick">
            {t('dash.quick')}
          </Link>
        )}
      </section>
      <div className="grid">
        {cards.map((c) => (
          <section key={c.to} className="card tile">
            <span className="tile-ic">{c.icon}</span>
            <h2>{c.title}</h2>
            <p className="muted">{c.body}</p>
            <Link to={c.to} className="go">
              {t('dash.open')} →
            </Link>
          </section>
        ))}
        <section className="card tile">
          <span className="tile-ic"><IconBolt /></span>
          <h2>{t('dash.planner')}</h2>
          <p className="muted">{t('dash.plannerStatus')}</p>
        </section>
      </div>
    </>
  );
}
