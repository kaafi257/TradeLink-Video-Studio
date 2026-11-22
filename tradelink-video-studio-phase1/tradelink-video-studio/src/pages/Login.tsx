import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n/i18n';
import { CenterCard } from '../components/CenterCard';

export function Login() {
  const { session, signIn } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailed(false);
    const ok = await signIn(email.trim(), password);
    setBusy(false);
    if (ok) navigate('/', { replace: true });
    else setFailed(true);
  }

  return (
    <CenterCard title={t('login.title')}>
      <form onSubmit={(e) => void onSubmit(e)} className="stack">
        <label className="field">
          <span>{t('login.email')}</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('login.password')}</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {failed && (
          <p className="error" role="alert">
            {t('login.error')}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t('login.submit')}
        </button>
        <p className="muted">{t('login.noSignup')}</p>
      </form>
    </CenterCard>
  );
}
