import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { config } from './lib/env';
import { isMember, needsMfa } from './lib/roles';
import { useI18n } from './i18n/i18n';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { CatalogueLayout } from './pages/catalogue/CatalogueLayout';
import { Overview } from './pages/catalogue/Overview';
import { Products } from './pages/catalogue/Products';
import { Categories } from './pages/catalogue/Categories';
import { Suppliers } from './pages/catalogue/Suppliers';
import { Campaigns } from './pages/catalogue/Campaigns';
import { SyncSettings } from './pages/catalogue/SyncSettings';
import { Videos } from './pages/videos/Videos';
import { VideoWizard } from './pages/videos/VideoWizard';
import { VideoEditor } from './pages/videos/VideoEditor';
import { Settings } from './pages/Settings';
import { AccessDenied } from './pages/AccessDenied';
import { MfaEnroll } from './pages/MfaEnroll';
import { MfaChallenge } from './pages/MfaChallenge';
import { ConfigError } from './pages/ConfigError';

function Splash() {
  const { t } = useI18n();
  return <p className="splash">{t('common.loading')}</p>;
}

// Needs a signed-in user, nothing more (used by the access-denied and MFA screens).
function RequireSession() {
  const { loading, session } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

// Full guard: signed in, active profile, and (for the owner) authenticator verified.
function RequireMember() {
  const { loading, session, profile, mfa } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!isMember(profile)) return <Navigate to="/access-denied" replace />;
  if (needsMfa(profile)) {
    if (!mfa.hasVerifiedFactor) return <Navigate to="/mfa/enroll" replace />;
    if (mfa.level !== 'aal2') return <Navigate to="/mfa/challenge" replace />;
  }
  return <Layout />;
}

export function App() {
  if (!config.ok) return <ConfigError />;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireSession />}>
          <Route path="/access-denied" element={<AccessDenied />} />
          <Route path="/mfa/enroll" element={<MfaEnroll />} />
          <Route path="/mfa/challenge" element={<MfaChallenge />} />
        </Route>
        <Route element={<RequireMember />}>
          <Route index element={<Dashboard />} />
          <Route path="/catalogue" element={<CatalogueLayout />}>
            <Route index element={<Overview />} />
            <Route path="products" element={<Products />} />
            <Route path="categories" element={<Categories />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="sync" element={<SyncSettings />} />
          </Route>
          <Route path="/videos" element={<Videos />} />
          <Route path="/videos/new" element={<VideoWizard />} />
          <Route path="/videos/:id" element={<VideoEditor />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
