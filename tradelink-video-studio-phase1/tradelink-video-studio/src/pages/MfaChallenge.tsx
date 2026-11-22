import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n/i18n';
import { CenterCard } from '../components/CenterCard';

export function MfaChallenge() {
  const { reload } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setFailed(false);
    const factors = await supabase.auth.mfa.listFactors();
    const factor = factors.data?.totp?.[0];
    if (!factor) {
      setFailed(true);
      return;
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
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
    <CenterCard title={t('mfa.challengeTitle')}>
      <p>{t('mfa.challengeBody')}</p>
      <form onSubmit={(e) => void onSubmit(e)} className="stack">
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
    </CenterCard>
  );
}
