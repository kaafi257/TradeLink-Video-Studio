import type { VideoSceneRow } from '../../lib/videos';
import { useI18n } from '../../i18n/i18n';

/** A quick look at the whole video: one small 9:16 card per scene, in order, with its picture, wording and length. */
export function Storyboard({ scenes, urls, style }: { scenes: VideoSceneRow[]; urls: Record<string, string>; style: string }) {
  const { t } = useI18n();
  const total = scenes.reduce((a, s) => a + s.duration_ms, 0) / 1000;
  return (
    <section className="card" aria-label={t('vid.story.title')}>
      <div className="row between"><h2>{t('vid.story.title')}</h2><span className="muted small">{total} s</span></div>
      <ol className={`story story-${style}`}>
        {scenes.map((s) => {
          const img = s.image_path ? urls[s.image_path] : null;
          return (
            <li key={s.id} className={`story-card${img ? ' has-img' : ''}`} style={{ flex: `${s.duration_ms} 0 64px` }}>
              <div className="story-frame">
                {img && <img src={img} alt="" />}
                <span className="story-text"><strong>{s.headline}</strong>{s.body && <small>{s.body}</small>}</span>
              </div>
              <span className="story-len muted small">{(s.duration_ms / 1000).toFixed(0)} s</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
