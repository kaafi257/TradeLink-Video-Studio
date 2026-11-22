import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n/i18n';
import { CenterCard } from '../components/CenterCard';

interface Enrollment {
  factorId: string;
  qr: string;
  secret: string;
}

export function MfaEnroll() {
  const { reload } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const started = useRef(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current || !supabase) return;
    started.current = true;
    void (async () => {
      // Remove any half-finished enrolment first so only one pending factor exists.
      const existing = await supabase.auth.mfa.listFactors();
      for (const f of existing.data?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `studio-${Date.now()}`,
      });
      if (error || !data) {
        setFailed(true);
        return;
      }
      setEnrollment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !enrollment) return;
    setFailed(false);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code: code.trim(),
    });
    if (error) {
      setFailed(true);
      return;
    }
    await reload();
    navigate('/', { replace: true });
  }

  return (
    <CenterCard title={t('mfa.enrollTitle')}>
      <p>{t('mfa.enrollBody')}</p>
      {enrollment ? (
        <form onSubmit={(e) => void onSubmit(e)} className="stack">
          <img className="qr" src={enrollment.qr} alt="QR code" width={192} height={192} />
          <p className="muted">
            {t('mfa.secretLabel')}: <code>{enrollment.secret}</code>
          </p>
          <label className="field">
            <span>{t('mfa.codeLabel')}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {failed && (
            <p className="error" role="alert">
              {t('mfa.error')}
            </p>
          )}
          <button type="submit" className="btn btn-primary">
            {t('mfa.verify')}
          </button>
        </form>
      ) : (
        <p className="muted">{failed ? t('mfa.error') : t('common.loading')}</p>
      )}
    </CenterCard>
  );
}
