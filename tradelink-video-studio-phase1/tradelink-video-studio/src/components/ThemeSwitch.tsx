import { useState } from 'react';
import { useI18n } from '../i18n/i18n';
import { IconMoon, IconSun } from './icons';

const KEY = 'studio-theme';
type Theme = 'light' | 'dark';

function effective(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Applies a saved choice before the first paint. Storage may be unavailable: then the device setting is used. */
export function applySavedTheme() {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v;
  } catch {
    /* storage blocked: follow the device */
  }
}

export function ThemeSwitch() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(effective);
  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* not saved; still applied for this visit */
    }
  }
  return (
    <button type="button" className="theme-btn" onClick={toggle} aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')} title={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}>
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  );
}
