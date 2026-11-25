import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Campaign, Product, Supplier } from '../../lib/catalogue';
import type { CtaType } from '../../lib/scenes';

export type VideoSettings = Partial<Record<`cta_${CtaType}`, string | null>> & { default_language?: string | null };

/** Approved catalogue data the video screens need (one loader for the wizard and Quick create). */
export function useVideoCatalogue() {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignLinks, setCampaignLinks] = useState<Array<{ campaign_id: string; product_id: string }>>([]);
  const [consented, setConsented] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<VideoSettings>({});
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [p, s, c, cp, sc, st] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('campaigns').select('*').order('name'),
      supabase.from('campaign_products').select('campaign_id, product_id'),
      supabase.from('supplier_consents').select('supplier_id, withdrawn'),
      supabase.from('app_settings').select('cta_whatsapp, cta_telegram, cta_phone, cta_website, default_language').maybeSingle(),
    ]);
    if (p.error || s.error || c.error || cp.error || sc.error) return setLoadFailed(true);
    setProducts((p.data ?? []) as Product[]);
    setSuppliers(((s.data ?? []) as Supplier[]).filter((x) => x.active));
    setCampaigns(((c.data ?? []) as Campaign[]).filter((x) => x.active));
    setCampaignLinks((cp.data ?? []) as Array<{ campaign_id: string; product_id: string }>);
    setConsented(new Set(((sc.data ?? []) as Array<{ supplier_id: string; withdrawn: boolean }>).filter((r) => !r.withdrawn).map((r) => r.supplier_id)));
    setSettings((st.data ?? {}) as VideoSettings);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return { products, suppliers, campaigns, campaignLinks, consented, settings, loaded, loadFailed, reload: load };
}
