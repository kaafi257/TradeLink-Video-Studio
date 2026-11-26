import type { ReactNode } from 'react';
import { LanguageSwitch } from './LanguageSwitch';
import { DraftNotice } from './DraftNotice';
import { useI18n } from '../i18n/i18n';
import { ThemeSwitch } from './ThemeSwitch';
import { IconFilm } from './icons';

export function CenterCard({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="center-wrap">
      <div className="center-top">
        <strong className="brand">
          <span className="brand-mark" aria-hidden="true"><IconFilm /></span>
          <span>{t('app.name')}</span>
        </strong>
        <span className="row">
          <LanguageSwitch />
          <ThemeSwitch />
        </span>
      </div>
      <DraftNotice />
      <section className="card center-card">
        <h1>{title}</h1>
        {children}
      </section>
    </div>
  );
}
