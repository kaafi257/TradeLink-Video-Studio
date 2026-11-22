import { config } from '../lib/env';
import { useI18n } from '../i18n/i18n';
import { CenterCard } from '../components/CenterCard';

// Shows the reason only; it never prints any key or address value.
export function ConfigError() {
  const { t } = useI18n();
  return (
    <CenterCard title={t('config.title')}>
      <p>{t('config.body')}</p>
      {!config.ok && <p className="muted">{config.reason}</p>}
    </CenterCard>
  );
}
