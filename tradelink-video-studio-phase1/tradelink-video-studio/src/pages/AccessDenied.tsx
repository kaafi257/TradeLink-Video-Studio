import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n/i18n';
import { CenterCard } from '../components/CenterCard';

export function AccessDenied() {
  const { signOut } = useAuth();
  const { t } = useI18n();
  return (
    <CenterCard title={t('denied.title')}>
      <p>{t('denied.body')}</p>
      <button type="button" className="btn" onClick={() => void signOut()}>
        {t('nav.signOut')}
      </button>
    </CenterCard>
  );
}
