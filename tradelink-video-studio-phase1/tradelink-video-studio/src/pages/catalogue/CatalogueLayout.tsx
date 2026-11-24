import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { canWriteCatalogue } from '../../lib/catalogue';
import { useI18n } from '../../i18n/i18n';

export function CatalogueLayout() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const tabs = [
    ['/catalogue', 'cat.tab.overview', true],
    ['/catalogue/products', 'cat.tab.products', false],
    ['/catalogue/categories', 'cat.tab.categories', false],
    ['/catalogue/suppliers', 'cat.tab.suppliers', false],
    ['/catalogue/campaigns', 'cat.tab.campaigns', false],
    ['/catalogue/sync', 'cat.tab.sync', false],
  ] as const;
  return (
    <>
      <h1>{t('cat.title')}</h1>
      <nav className="subnav" aria-label={t('cat.title')}>
        {tabs.map(([to, key, end]) => (
          <NavLink key={to} to={to} end={end}>{t(key)}</NavLink>
        ))}
      </nav>
      {!canWriteCatalogue(profile) && <p className="muted" role="note">{t('common.readOnly')}</p>}
      <Outlet />
    </>
  );
}
