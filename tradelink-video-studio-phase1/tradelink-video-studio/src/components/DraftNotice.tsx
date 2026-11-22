import { useI18n } from '../i18n/i18n';

// Shown whenever Amharic is active, because all Amharic text is an unreviewed draft.
export function DraftNotice() {
  const { isDraft, t } = useI18n();
  if (!isDraft) return null;
  return (
    <p className="draft-notice" role="note">
      <strong>DRAFT</strong> · {t('common.draftTranslation')}
    </p>
  );
}
