import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { config } from './lib/env';
import { isMember, needsMfa } from './lib/roles';
import { useI18n } from './i18n/i18n';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
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
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
