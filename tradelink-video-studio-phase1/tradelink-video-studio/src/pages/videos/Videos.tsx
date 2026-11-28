import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { canWriteCatalogue, formatDate } from '../../lib/catalogue';
import { type VideoProject, type VideoStatus } from '../../lib/videos';
import { Loading } from '../../components/Loading';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';

const CHIP: Record<VideoStatus, string> = {
  draft: 'chip', queued: 'chip chip-warn', rendering: 'chip chip-warn', failed: 'chip chip-bad',
  ready_to_post: 'chip chip-ok', published_manually: 'chip chip-ok', archived: 'chip chip-off',
};

export function StatusChip({ status }: { status: VideoStatus }) {
  const { t } = useI18n();
  return <span className={CHIP[status]}>{t(`vid.status.${status}` as MessageKey)}</span>;
}

export function Videos() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const canWrite = canWriteCatalogue(profile);
  const [rows, setRows] = useState<VideoProject[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('video_projects').select('*').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (error) setFailed(true);
      else setRows((data ?? []) as VideoProject[]);
    });
  }, []);

  return (
    <>
      <div className="row between">
        <h1>{t('vid.title')}</h1>
        {canWrite && <span className="row"><Link className="btn btn-primary" to="/videos/quick">{t('vid.quick.open')}</Link> <Link className="btn" to="/videos/batch">{t('batch.open')}</Link> <Link className="btn" to="/videos/new">{t('vid.new')}</Link></span>}
      </div>
      {failed && <p role="alert" className="error">{t('common.loadError')}</p>}
      {rows === null && !failed && <Loading />}
      {rows?.length === 0 && <p className="card muted">{t('vid.empty')}</p>}
      <ul className="vlist">
        {rows?.map((v) => (
          <li key={v.id}>
            <Link className="vitem" to={`/videos/${v.id}`}>
              <strong>{v.title}</strong>
              <span className="muted small">
                {t(`vid.type.${v.video_type}` as MessageKey)} · {v.duration_seconds} s · {v.language.toUpperCase()} · {formatDate(v.created_at)}
              </span>
              <StatusChip status={v.status} />
              {v.status === 'failed' && v.status_note && <span className="small error">{v.status_note}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
