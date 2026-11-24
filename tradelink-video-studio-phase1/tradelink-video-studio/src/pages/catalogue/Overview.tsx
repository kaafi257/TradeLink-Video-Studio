import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { canWriteCatalogue, videoEligible, type Product } from '../../lib/catalogue';
import { useI18n } from '../../i18n/i18n';

interface Counts { products: Product[]; categories: number; suppliers: number; campaigns: number }

export function Overview() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const [data, setData] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    const db = supabase;
    void Promise.all([
      db.from('products').select('id, name, active, image_approved, image_path'),
      db.from('categories').select('id'),
      db.from('suppliers').select('id'),
      db.from('campaigns').select('id'),
    ]).then(([p, c, s, k]) => {
      if (p.error || c.error || s.error || k.error) return setFailed(true);
      setData({ products: (p.data ?? []) as Product[], categories: c.data?.length ?? 0, suppliers: s.data?.length ?? 0, campaigns: k.data?.length ?? 0 });
    });
  }, []);

  if (failed) return <p className="error" role="alert">{t('common.loadError')}</p>;
  if (!data) return <p className="splash">{t('common.loading')}</p>;
  const ready = data.products.filter(videoEligible).length;
  const stats: Array<[string, number]> = [
    ['ov.products', data.products.length], ['ov.categories', data.categories], ['ov.suppliers', data.suppliers],
    ['ov.campaigns', data.campaigns], ['ov.videoReady', ready], ['ov.needImage', data.products.length - ready],
  ];
  return (
    <div className="stack">
      <div className="stats">
        {stats.map(([k, n]) => (
          <section key={k} className="card stat">
            <span className="stat-n">{n}</span>
            <span className="muted">{t(k as 'ov.products')}</span>
          </section>
        ))}
      </div>
      <p className="muted">{t('ov.hint')}</p>
      {data.products.length === 0 && (
        <section className="card">
          <p>{t('ov.empty')}</p>
          {canWriteCatalogue(profile) && (
            <p className="row">
              <Link className="btn" to="/catalogue/categories">{t('ent.cat.add')}</Link>
              <Link className="btn btn-primary" to="/catalogue/products">{t('prod.add')}</Link>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
