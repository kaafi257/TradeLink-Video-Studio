import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import {
  canWriteCatalogue, filterProducts, formatDate, formatPrice, productPayload, sortProducts, STOCK_STATUSES, validateProduct,
  videoEligible, type Category, type Product, type ProductErrors, type ProductForm, type SortKey, type StatusFilter, type Supplier,
} from '../../lib/catalogue';
import { removeImages, saveWithImage } from '../../lib/images';
import { useImageUrls } from '../../lib/useImageUrls';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';
import { Sheet } from '../../components/Sheet';
import { ImageField } from '../../components/ImageField';

type Panel = { kind: 'form'; product: Product | null } | { kind: 'detail'; id: string } | { kind: 'delete'; id: string } | null;

function toForm(p: Product | null): ProductForm {
  const s = (v: string | number | null) => (v === null || v === undefined ? '' : String(v));
  return {
    name: p?.name ?? '', description: s(p?.description ?? null), category_id: p?.category_id ?? '', supplier_id: p?.supplier_id ?? '',
    brand: s(p?.brand ?? null), unit: s(p?.unit ?? null), package_size: s(p?.package_size ?? null),
    min_order_quantity: s(p?.min_order_quantity ?? null), retail_price: s(p?.retail_price ?? null), sale_price: s(p?.sale_price ?? null),
    stock_status: p?.stock_status ?? 'unknown', stock_quantity: s(p?.stock_quantity ?? null),
    image_approved: p?.image_approved ?? false, active: p?.active ?? true,
  };
}

export function Products() {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const canWrite = canWriteCatalogue(profile);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [p, c, s] = await Promise.all([
      supabase.from('products').select('*'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
    ]);
    if (p.error || c.error || s.error) return setFailed(true);
    setProducts((p.data ?? []) as Product[]);
    setCategories((c.data ?? []) as Category[]);
    setSuppliers((s.data ?? []) as Supplier[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const urls = useImageUrls((products ?? []).map((p) => p.image_path));
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const shown = useMemo(
    () => sortProducts(filterProducts(products ?? [], { q, categoryId, status }), sort),
    [products, q, categoryId, status, sort],
  );

  async function toggleActive(p: Product) {
    if (!supabase) return;
    const { error } = await supabase.from('products').update({ active: !p.active }).eq('id', p.id);
    setNotice(error ? t('common.saveError') : null);
    await load();
  }

  async function confirmDelete(p: Product) {
    if (!supabase) return;
    const { error } = await supabase.from('products').delete().eq('id', p.id);
    if (error) { setNotice(t('common.deleteError')); return; }
    await removeImages([p.image_path]);
    setPanel(null);
    setNotice(null);
    await load();
  }

  if (failed) return <p className="error" role="alert">{t('common.loadError')}</p>;
  if (!products) return <p className="splash">{t('common.loading')}</p>;
  const current = panel && panel.kind !== 'form' ? products.find((p) => p.id === panel.id) ?? null : null;

  return (
    <div className="stack">
      <div className="filters">
        <input type="search" aria-label={t('prod.search')} placeholder={t('prod.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('f.category')} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{t('prod.allCategories')}</option>
          <option value="none">{t('prod.uncategorised')}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label={t('f.status')} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="all">{t('common.all')}</option>
          <option value="active">{t('common.active')}</option>
          <option value="inactive">{t('common.inactive')}</option>
        </select>
        <select aria-label={t('prod.sort')} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="name">{t('prod.sortName')}</option>
          <option value="newest">{t('prod.sortNewest')}</option>
          <option value="price_low">{t('prod.sortPriceLow')}</option>
          <option value="price_high">{t('prod.sortPriceHigh')}</option>
        </select>
        {canWrite && <button type="button" className="btn btn-primary big" onClick={() => setPanel({ kind: 'form', product: null })}>{t('prod.add')}</button>}
      </div>
      {notice && <p className="error" role="alert">{notice}</p>}

      {products.length === 0 ? <p className="muted">{t('prod.none')}</p> : shown.length === 0 ? <p className="muted">{t('prod.noMatch')}</p> : (
        <ul className="cards">
          {shown.map((p) => (
            <li key={p.id} className={`pcard${p.active ? '' : ' off'}`}>
              <button type="button" className="pcard-main" onClick={() => setPanel({ kind: 'detail', id: p.id })}>
                <span className="thumb">{p.image_path && urls[p.image_path] ? <img src={urls[p.image_path]} alt="" loading="lazy" /> : <span className="muted small">{t('prod.noImage')}</span>}</span>
                <span className="pname">{p.name}</span>
                <span className="muted small">{p.category_id ? catName.get(p.category_id) ?? '' : t('prod.uncategorised')}</span>
                <Price p={p} lang={lang} t={t} />
              </button>
              <span className="chips">
                {!p.active && <span className="chip chip-off">{t('common.inactive')}</span>}
                <span className={`chip ${p.image_approved ? 'chip-ok' : 'chip-warn'}`}>{p.image_approved ? t('prod.imageApproved') : t('prod.imageNotApproved')}</span>
              </span>
              {canWrite && <button type="button" className="btn small-btn" onClick={() => void toggleActive(p)}>{p.active ? t('common.deactivate') : t('common.activate')}</button>}
            </li>
          ))}
        </ul>
      )}

      {panel?.kind === 'form' && (
        <Sheet title={panel.product ? t('common.edit') + ': ' + panel.product.name : t('prod.new')} onClose={() => setPanel(null)}>
          <ProductFormView product={panel.product} categories={categories} suppliers={suppliers} currentUrl={panel.product?.image_path ? urls[panel.product.image_path] ?? null : null}
            onCancel={() => setPanel(null)} onSaved={async () => { setPanel(null); await load(); }} />
        </Sheet>
      )}
      {panel?.kind === 'detail' && current && (
        <Sheet title={current.name} onClose={() => setPanel(null)}>
          <Detail p={current} url={current.image_path ? urls[current.image_path] ?? null : null} catName={current.category_id ? catName.get(current.category_id) ?? '' : t('prod.uncategorised')}
            supName={suppliers.find((s) => s.id === current.supplier_id)?.name ?? ''} canWrite={canWrite}
            onEdit={() => setPanel({ kind: 'form', product: current })} onDelete={() => setPanel({ kind: 'delete', id: current.id })} onToggle={() => void toggleActive(current)} />
        </Sheet>
      )}
      {panel?.kind === 'delete' && current && (
        <Sheet title={t('prod.deleteTitle')} onClose={() => setPanel(null)}>
          <p><strong>{current.name}</strong></p>
          <p className="muted">{t('prod.deleteBody')}</p>
          {notice && <p className="error" role="alert">{notice}</p>}
          <div className="row">
            <button type="button" className="btn" onClick={() => setPanel(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-danger" onClick={() => void confirmDelete(current)}>{t('common.delete')}</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Price({ p, lang, t }: { p: Product; lang: 'en' | 'am'; t: (k: MessageKey) => string }) {
  if (p.retail_price === null) return <span className="muted small">{t('prod.priceNotSet')}</span>;
  if (p.sale_price !== null) return <span className="price"><strong>{formatPrice(p.sale_price, lang)}</strong> <s className="muted small">{formatPrice(p.retail_price, lang)}</s></span>;
  return <span className="price"><strong>{formatPrice(p.retail_price, lang)}</strong></span>;
}

function Detail(props: { p: Product; url: string | null; catName: string; supName: string; canWrite: boolean; onEdit: () => void; onDelete: () => void; onToggle: () => void }) {
  const { t, lang } = useI18n();
  const { p } = props;
  const rows: Array<[MessageKey, string]> = [
    ['f.category', props.catName], ['f.supplier', props.supName], ['f.brand', p.brand ?? ''], ['f.unit', p.unit ?? ''], ['f.packageSize', p.package_size ?? ''],
    ['f.moq', p.min_order_quantity === null ? '' : String(p.min_order_quantity)],
    ['f.retail', p.retail_price === null ? '' : formatPrice(p.retail_price, lang)], ['f.sale', p.sale_price === null ? '' : formatPrice(p.sale_price, lang)],
    ['f.stockStatus', t(`stock.${p.stock_status}` as MessageKey)], ['f.stockQty', p.stock_quantity === null ? '' : String(p.stock_quantity)],
  ];
  return (
    <div className="stack">
      <div className="detail-img">{props.url ? <img src={props.url} alt={p.name} /> : <span className="muted">{t('prod.noImage')}</span>}</div>
      <p className="chips">
        <span className={`chip ${p.active ? 'chip-ok' : 'chip-off'}`}>{p.active ? t('common.active') : t('common.inactive')}</span>
        <span className={`chip ${p.image_approved ? 'chip-ok' : 'chip-warn'}`}>{p.image_approved ? t('prod.imageApproved') : t('prod.imageNotApproved')}</span>
        <span className={`chip ${videoEligible(p) ? 'chip-ok' : 'chip-off'}`}>{videoEligible(p) ? t('prod.videoReady') : t('prod.notVideoReady')}</span>
      </p>
      {p.description && <p>{p.description}</p>}
      <dl className="facts">
        {rows.filter(([, v]) => v !== '').map(([k, v]) => <div key={k}><dt className="muted">{t(k)}</dt><dd>{v}</dd></div>)}
        <div><dt className="muted">{t('f.created')}</dt><dd>{formatDate(p.created_at)}</dd></div>
        <div><dt className="muted">{t('f.updated')}</dt><dd>{formatDate(p.updated_at)}</dd></div>
      </dl>
      {props.canWrite && (
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={props.onEdit}>{t('common.edit')}</button>
          <button type="button" className="btn" onClick={props.onToggle}>{p.active ? t('common.deactivate') : t('common.activate')}</button>
          <button type="button" className="btn btn-danger" onClick={props.onDelete}>{t('common.delete')}</button>
        </div>
      )}
    </div>
  );
}

function ProductFormView(props: { product: Product | null; categories: Category[]; suppliers: Supplier[]; currentUrl: string | null; onCancel: () => void; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const { product } = props;
  const [f, setF] = useState<ProductForm>(() => toForm(product));
  const [img, setImg] = useState<{ file: File | null; removed: boolean }>({ file: null, removed: false });
  const [errors, setErrors] = useState<ProductErrors>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const hasSaved = !!product?.image_path;
  const hasImage = img.file !== null || (hasSaved && !img.removed);
  const msg = (e: string | undefined) => (e ? t(`err.${e}` as MessageKey) : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validateProduct(f, hasImage);
    setErrors(v.errors);
    if (!v.ok || !supabase) return;
    setBusy(true);
    setProblem(null);
    const db = supabase;
    const res = await saveWithImage('products', { file: img.file, removed: img.removed, oldPath: product?.image_path ?? null }, async (path) => {
      const body = { ...productPayload(f), ...(path !== undefined ? { image_path: path } : {}) };
      return product ? db.from('products').update(body).eq('id', product.id) : db.from('products').insert(body);
    });
    setBusy(false);
    if (res.ok) await props.onSaved();
    else setProblem(res.stage === 'upload' ? t('img.uploadError') : t('common.saveError'));
  }

  const field = (k: keyof ProductErrors | null, label: MessageKey, input: React.ReactNode, optional = true) => (
    <div className="fieldwrap">
      <label className="field">
        <span>{t(label)}{optional && <span className="muted small"> ({t('common.optional')})</span>}</span>
        {input}
      </label>
      {k && errors[k] && <span className="error small" role="alert">{msg(errors[k])}</span>}
    </div>
  );
  const text = (k: 'description' | 'brand' | 'unit' | 'package_size', mode?: 'text') => <input type="text" inputMode={mode} value={f[k]} onChange={(e) => set(k, e.target.value)} />;

  return (
    <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
      {field('name', 'f.name', <input type="text" value={f.name} maxLength={200} onChange={(e) => set('name', e.target.value)} required />, false)}
      <label className="field"><span>{t('f.description')} <span className="muted small">({t('common.optional')})</span></span>
        <textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
      <div className="two">
        <label className="field"><span>{t('f.category')}</span>
          <select value={f.category_id} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">{t('prod.uncategorised')}</option>
            {props.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className="field"><span>{t('f.supplier')}</span>
          <select value={f.supplier_id} onChange={(e) => set('supplier_id', e.target.value)}>
            <option value="">{t('common.none')}</option>
            {props.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
      </div>
      <div className="two">
        {field(null, 'f.brand', text('brand'))}
        {field(null, 'f.unit', text('unit'))}
        {field(null, 'f.packageSize', text('package_size'))}
        {field('min_order_quantity', 'f.moq', <input type="text" inputMode="numeric" value={f.min_order_quantity} onChange={(e) => set('min_order_quantity', e.target.value)} />)}
        {field('retail_price', 'f.retail', <input type="text" inputMode="decimal" value={f.retail_price} onChange={(e) => set('retail_price', e.target.value)} />)}
        {field('sale_price', 'f.sale', <input type="text" inputMode="decimal" value={f.sale_price} onChange={(e) => set('sale_price', e.target.value)} />)}
        <label className="field"><span>{t('f.stockStatus')}</span>
          <select value={f.stock_status} onChange={(e) => set('stock_status', e.target.value as ProductForm['stock_status'])}>
            {STOCK_STATUSES.map((s) => <option key={s} value={s}>{t(`stock.${s}` as MessageKey)}</option>)}
          </select></label>
        {field('stock_quantity', 'f.stockQty', <input type="text" inputMode="numeric" value={f.stock_quantity} onChange={(e) => set('stock_quantity', e.target.value)} />)}
      </div>
      <ImageField label="f.image" currentUrl={props.currentUrl} hasSaved={hasSaved} file={img.file} removed={img.removed} disabled={busy}
        onChange={(n) => { setImg(n); set('image_approved', false); }} />
      <label className="check"><input type="checkbox" checked={f.image_approved} disabled={!hasImage} onChange={(e) => set('image_approved', e.target.checked)} /> {t('f.approved')}</label>
      {errors.image_approved && <p className="error small" role="alert">{msg(errors.image_approved)}</p>}
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> {t('common.active')}</label>
      {problem && <p className="error" role="alert">{problem}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={props.onCancel} disabled={busy}>{t('common.cancel')}</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</button>
      </div>
    </form>
  );
}
