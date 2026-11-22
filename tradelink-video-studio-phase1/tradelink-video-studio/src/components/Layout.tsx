import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n/i18n';
import { LanguageSwitch } from './LanguageSwitch';
import { DraftNotice } from './DraftNotice';

export function Layout() {
  const { signOut } = useAuth();
  const { t } = useI18n();
  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">{t('app.name')}</strong>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            {t('nav.dashboard')}
          </NavLink>
          <NavLink to="/settings">{t('nav.settings')}</NavLink>
        </nav>
        <div className="topbar-right">
          <LanguageSwitch />
          <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>
            {t('nav.signOut')}
          </button>
        </div>
      </header>
      <DraftNotice />
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
