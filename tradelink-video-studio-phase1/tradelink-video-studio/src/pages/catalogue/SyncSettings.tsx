import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/catalogue';
import { useI18n } from '../../i18n/i18n';

interface Run { id: string; started_at: string; finished_at: string | null; status: 'running' | 'succeeded' | 'failed'; summary: Summary | null; error: string | null }
interface Summary {
  counts?: Record<string, number>; skipped?: string[];
  pictures?: { copied: number; failed: number; remaining: number; skipped: number };
}

/** Owner-only "Sync now": the Edge Function reads the TradeLink PUBLIC views and copies into this Studio. Nothing is sent to TradeLink. */
export function SyncSettings() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; summary?: Summary; text?: string } | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('sync_runs').select('id, started_at, finished_at, status, summary, error').order('started_at', { ascending: false }).limit(10);
    setRuns(error ? [] : ((data ?? []) as Run[]));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function syncNow() {
    if (!supabase) return;
    setBusy(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke('sync-marketplace', { method: 'POST', body: {} });
    setBusy(false);
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      setResult({ kind: 'error', text: status === 404 || !status ? t('sync.notDeployed') : status === 403 ? t('sync.ownerOnly') : status === 409 ? t('sync.running') : t('sync.failed') });
    } else if (data && (data as { ok?: boolean }).ok) {
      setResult({ kind: 'ok', summary: data as Summary });
    } else {
      setResult({ kind: 'error', text: `${t('sync.failed')} ${(data as { error?: string } | null)?.error ?? ''}`.trim() });
    }
    void load();
  }

  const last = runs?.find((r) => r.status === 'succeeded');
  return (
    <div className="stack">
      <section className="card">
        <h2>{t('sync.title')}</h2>
        <dl className="facts">
          <div><dt className="muted">{t('sync.last')}</dt><dd>{last?.finished_at ? formatDate(last.finished_at) : t('sync.unavailable')}</dd></div>
          <div><dt className="muted">{t('sync.auto')}</dt><dd>{t('sync.disabled')}</dd></div>
        </dl>
        <p className="row">
          <button type="button" className="btn btn-primary" disabled={!isOwner || busy} onClick={() => void syncNow()}>
            {busy ? t('sync.working') : t('sync.now')}
          </button>
        </p>
        {!isOwner && <p className="muted">{t('sync.ownerOnly')}</p>}
        <p className="muted">{t('sync.explain')}</p>
        {result?.kind === 'error' && <p role="alert" className="error">{result.text}</p>}
        {result?.kind === 'ok' && <SummaryView summary={result.summary ?? {}} />}
      </section>
      <section className="card">
        <h2>{t('sync.history')}</h2>
        {runs === null && <p className="muted">…</p>}
        {runs?.length === 0 && <p className="muted">{t('sync.empty')}</p>}
        <ul className="history">
          {runs?.map((r) => (
            <li key={r.id}>
              {formatDate(r.started_at)} · {t(`sync.status.${r.status}` as 'sync.status.running')}
              {r.error ? ` · ${r.error}` : ''}
              {r.status === 'succeeded' && r.summary?.counts ? ` · ${t('sync.newItems')}: ${(r.summary.counts.products_new ?? 0) + (r.summary.counts.categories_new ?? 0) + (r.summary.counts.suppliers_new ?? 0)}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SummaryView({ summary }: { summary: Summary }) {
  const { t } = useI18n();
  const c = summary.counts ?? {};
  const p = summary.pictures;
  return (
    <div className="subcard" role="status" data-testid="sync-summary">
      <h3>{t('sync.done')}</h3>
      <p className="small">
        {t('sync.cats')}: {c.categories_new ?? 0} · {t('sync.sups')}: {c.suppliers_new ?? 0} · {t('sync.prods')}: {c.products_new ?? 0} · {t('sync.skippedRows')}: {c.rows_skipped ?? 0}
      </p>
      {p && <p className="small">{t('sync.pics')}: {p.copied} · {t('sync.picsFailed')}: {p.failed + p.skipped}</p>}
      {p && p.remaining > 0 && <p className="notice small">{t('sync.more').replace('{n}', String(p.remaining))}</p>}
      {(summary.skipped?.length ?? 0) > 0 && (
        <details>
          <summary>{t('sync.skippedList')}</summary>
          <ul className="history small">{summary.skipped!.map((s) => <li key={s}>{s}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
