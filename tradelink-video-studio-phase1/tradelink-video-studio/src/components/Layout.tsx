import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n/i18n';
import { LanguageSwitch } from './LanguageSwitch';
import { DraftNotice } from './DraftNotice';
import { ThemeSwitch } from './ThemeSwitch';
import { IconBox, IconFilm, IconGear, IconHome } from './icons';

export function Layout() {
  const { signOut } = useAuth();
  const { t } = useI18n();
  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">
          <span className="brand-mark" aria-hidden="true"><IconFilm /></span>
          <span className="brand-text">{t('app.name')}</span>
        </strong>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            <IconHome />
            <span>{t('nav.dashboard')}</span>
          </NavLink>
          <NavLink to="/catalogue">
            <IconBox />
            <span>{t('nav.catalogue')}</span>
          </NavLink>
          <NavLink to="/videos">
            <IconFilm />
            <span>{t('nav.videos')}</span>
          </NavLink>
          <NavLink to="/settings">
            <IconGear />
            <span>{t('nav.settings')}</span>
          </NavLink>
        </nav>
        <div className="topbar-right">
          <LanguageSwitch />
          <ThemeSwitch />
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
