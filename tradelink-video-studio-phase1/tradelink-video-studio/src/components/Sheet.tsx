import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n/i18n';

// A simple modal panel: full width on phones, centred on larger screens. Escape closes it.
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="sheet-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-icon" aria-label={t('common.close')} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
