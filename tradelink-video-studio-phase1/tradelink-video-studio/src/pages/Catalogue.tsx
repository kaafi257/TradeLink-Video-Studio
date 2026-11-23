import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { canEditSettings } from '../lib/roles';
import { useI18n } from '../i18n/i18n';

interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: 'manual' | 'nightly';
  status: 'running' | 'ok' | 'failed';
  counts: Record<string, number>;
  error: string | null;
}

// DD/MM/YYYY HH:MM, numeric as the project conventions require.
function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function Catalogue() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const isOwner = canEditSettings(profile);
  const [runs, setRuns] = useState<SyncRun[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('sync_runs')
      .select('id, started_at, finished_at, trigger, status, counts, error')
      .order('started_at', { ascending: false })
      .limit(10);
    if (error) setMessage({ text: t('cat.loadError'), bad: true });
    else setRuns((data ?? []) as SyncRun[]);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncNow() {
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.functions.invoke('sync-catalogue', { method: 'POST' });
    setMessage(error ? { text: t('cat.failed'), bad: true } : { text: t('cat.started'), bad: false });
    await load();
    setBusy(false);
  }

  const statusLabel = (s: SyncRun['status']) => (s === 'ok' ? t('cat.ok') : s === 'running' ? t('cat.running') : t('cat.failedStatus'));
  const detail = (r: SyncRun) =>
    r.status === 'ok'
      ? Object.entries(r.counts).map(([k, v]) => `${k.replace('public_', '')}: ${v}`).join(', ')
      : (r.error ?? '');

  return (
    <>
      <h1>{t('cat.title')}</h1>
      <p className="muted">{t('cat.intro')}</p>
      <p>
        <button type="button" className="btn btn-primary" disabled={!isOwner || busy} onClick={() => void syncNow()}>
          {busy ? t('cat.syncing') : t('cat.syncNow')}
        </button>
      </p>
      {!isOwner && <p className="muted">{t('cat.ownerOnly')}</p>}
      {message && (
        <p role="status" className={message.bad ? 'error' : 'muted'}>
          {message.text}
        </p>
      )}
      <section className="card">
        <h2>{t('cat.history')}</h2>
        {runs && runs.length === 0 && <p className="muted">{t('cat.none')}</p>}
        {runs && runs.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>{t('cat.colStarted')}</th>
                  <th>{t('cat.colTrigger')}</th>
                  <th>{t('cat.colStatus')}</th>
                  <th>{t('cat.colDetail')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{fmt(r.started_at)}</td>
                    <td>{r.trigger === 'manual' ? t('cat.manual') : t('cat.nightly')}</td>
                    <td>{statusLabel(r.status)}</td>
                    <td>{detail(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
