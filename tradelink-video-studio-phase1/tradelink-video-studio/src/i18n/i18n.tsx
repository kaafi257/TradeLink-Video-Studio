import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { am, AM_DRAFT } from './am';

export type Lang = 'en' | 'am';
const STORAGE_KEY = 'studio.lang';

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey) => string;
  isDraft: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLang(): Lang {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'am' ? 'am' : 'en';
  } catch {
    return 'en';
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: keep the choice in memory only */
    }
  }, []);

  const t = useCallback((key: MessageKey) => (lang === 'am' ? am[key] : en[key]), [lang]);
  const value = useMemo(
    () => ({ lang, setLang, t, isDraft: lang === 'am' && AM_DRAFT }),
    [lang, setLang, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
