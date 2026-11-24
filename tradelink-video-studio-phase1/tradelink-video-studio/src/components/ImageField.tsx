import { useEffect, useId, useRef, useState } from 'react';
import { checkImageFile } from '../lib/catalogue';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

interface Props {
  label: MessageKey;
  currentUrl: string | null; // signed link of the saved image
  hasSaved: boolean;
  file: File | null;
  removed: boolean;
  onChange: (next: { file: File | null; removed: boolean }) => void;
  disabled?: boolean;
}

export function ImageField({ label, currentUrl, hasSaved, file, removed, onChange, disabled }: Props) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function pick(f: File | undefined) {
    if (!f) return;
    const p = checkImageFile(f);
    if (p) {
      setProblem(p === 'type' ? 'img.errType' : p === 'size' ? 'img.errSize' : 'img.errEmpty');
    } else {
      setProblem(null);
      onChange({ file: f, removed: false });
    }
    if (input.current) input.current.value = '';
  }

  const shown = preview ?? (!removed && hasSaved ? currentUrl : null);
  const has = shown !== null || (!removed && hasSaved);
  return (
    <div className="imgfield">
      <label className="imgfield-label" htmlFor={id}>{t(label)}</label>
      <div className="imgfield-box">
        {shown ? <img src={shown} alt="" /> : <span className="muted">{t('prod.noImage')}</span>}
      </div>
      <div className="imgfield-actions">
        <input id={id} ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={disabled} onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className="btn" disabled={disabled} onClick={() => input.current?.click()}>
          {has ? t('img.replace') : t('img.choose')}
        </button>
        {has && (
          <button type="button" className="btn" disabled={disabled} onClick={() => { setProblem(null); onChange({ file: null, removed: hasSaved }); }}>
            {t('img.remove')}
          </button>
        )}
      </div>
      <p className="muted small">{t('img.help')}</p>
      {problem && <p className="error small" role="alert">{t(problem)}</p>}
    </div>
  );
}
