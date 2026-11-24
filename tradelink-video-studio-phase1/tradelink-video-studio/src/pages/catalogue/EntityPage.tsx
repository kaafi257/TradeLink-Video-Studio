import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { canWriteCatalogue, formatDate, type ImageFolder } from '../../lib/catalogue';
import { removeImages, saveWithImage } from '../../lib/images';
import { useImageUrls } from '../../lib/useImageUrls';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';
import { Sheet } from '../../components/Sheet';
import { ImageField } from '../../components/ImageField';

export interface FieldDef {
  key: string;
  label: MessageKey;
  kind: 'text' | 'textarea' | 'select' | 'date';
  options?: Array<{ value: string; label: MessageKey }>;
  required?: boolean;
}
export interface EntityConfig {
  table: 'categories' | 'suppliers' | 'campaigns';
  folder: ImageFolder;
  imageKey: 'image_path' | 'logo_path' | 'banner_path';
  imageLabel: MessageKey;
  fields: FieldDef[];
  subtitleKeys: string[]; // columns shown under the name on the card
  text: { add: MessageKey; new: MessageKey; none: MessageKey; deleteTitle: MessageKey; deleteBody: MessageKey };
  linkProducts?: boolean; // campaigns: pick related products
}
type Row = Record<string, string | boolean | null> & { id: string; name: string; active: boolean; created_at: string; updated_at: string };
interface ProductLite { id: string; name: string }

export function EntityPage({ cfg }: { cfg: EntityConfig }) {
  const { t } = useI18n();
  const { profile } = useAuth();
  const canWrite = canWriteCatalogue(profile);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [links, setLinks] = useState<Record<string, string[]>>({});
  const [failed, setFailed] = useState(false);
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const r = await supabase.from(cfg.table).select('*').order('name');
    if (r.error) return setFailed(true);
    setRows((r.data ?? []) as Row[]);
    if (cfg.linkProducts) {
      const [p, l] = await Promise.all([supabase.from('products').select('id, name').order('name'), supabase.from('campaign_products').select('campaign_id, product_id')]);
      if (p.error || l.error) return setFailed(true);
      setProducts((p.data ?? []) as ProductLite[]);
      const map: Record<string, string[]> = {};
      for (const x of (l.data ?? []) as Array<{ campaign_id: string; product_id: string }>) (map[x.campaign_id] ??= []).push(x.product_id);
      setLinks(map);
    }
  }, [cfg.table, cfg.linkProducts]);
  useEffect(() => { void load(); }, [load]);

  const urls = useImageUrls((rows ?? []).map((r) => r[cfg.imageKey] as string | null));

  async function toggle(r: Row) {
    if (!supabase) return;
    const { error } = await supabase.from(cfg.table).update({ active: !r.active }).eq('id', r.id);
    setNotice(error ? t('common.saveError') : null);
    await load();
  }
  async function confirmDelete(r: Row) {
    if (!supabase) return;
    const { error } = await supabase.from(cfg.table).delete().eq('id', r.id);
    if (error) return setNotice(t('common.deleteError'));
    await removeImages([r[cfg.imageKey] as string | null]);
    setDel(null);
    setNotice(null);
    await load();
  }

  if (failed) return <p className="error" role="alert">{t('common.loadError')}</p>;
  if (!rows) return <p className="splash">{t('common.loading')}</p>;
  return (
    <div className="stack">
      {canWrite && <p><button type="button" className="btn btn-primary big" onClick={() => setEdit('new')}>{t(cfg.text.add)}</button></p>}
      {notice && <p className="error" role="alert">{notice}</p>}
      {rows.length === 0 ? <p className="muted">{t(cfg.text.none)}</p> : (
        <ul className="cards">
          {rows.map((r) => {
            const img = r[cfg.imageKey] as string | null;
            const sub = cfg.subtitleKeys.map((k) => (k.endsWith('_on') ? formatDate(r[k] as string | null) : k === 'campaign_type' ? t(`ctype.${r[k]}` as MessageKey) : (r[k] as string | null) ?? '')).filter(Boolean);
            return (
              <li key={r.id} className={`pcard${r.active ? '' : ' off'}`}>
                <button type="button" className="pcard-main" onClick={() => canWrite && setEdit(r)} disabled={!canWrite}>
                  <span className="thumb">{img && urls[img] ? <img src={urls[img]} alt="" loading="lazy" /> : <span className="muted small">{t('prod.noImage')}</span>}</span>
                  <span className="pname">{r.name}</span>
                  {sub.length > 0 && <span className="muted small">{sub.join(' · ')}</span>}
                </button>
                <span className="chips">{!r.active && <span className="chip chip-off">{t('common.inactive')}</span>}</span>
                {canWrite && (
                  <span className="row">
                    <button type="button" className="btn small-btn" onClick={() => void toggle(r)}>{r.active ? t('common.deactivate') : t('common.activate')}</button>
                    <button type="button" className="btn small-btn btn-danger" onClick={() => { setNotice(null); setDel(r); }}>{t('common.delete')}</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {edit && (
        <Sheet title={edit === 'new' ? t(cfg.text.new) : `${t('common.edit')}: ${edit.name}`} onClose={() => setEdit(null)}>
          <EntityForm cfg={cfg} row={edit === 'new' ? null : edit} products={products} linked={edit === 'new' ? [] : links[edit.id] ?? []}
            currentUrl={edit !== 'new' && edit[cfg.imageKey] ? urls[edit[cfg.imageKey] as string] ?? null : null}
            onCancel={() => setEdit(null)} onSaved={async () => { setEdit(null); await load(); }} />
        </Sheet>
      )}
      {del && (
        <Sheet title={t(cfg.text.deleteTitle)} onClose={() => setDel(null)}>
          <p><strong>{del.name}</strong></p>
          <p className="muted">{t(cfg.text.deleteBody)}</p>
          {notice && <p className="error" role="alert">{notice}</p>}
          <div className="row">
            <button type="button" className="btn" onClick={() => setDel(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-danger" onClick={() => void confirmDelete(del)}>{t('common.delete')}</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function EntityForm(props: { cfg: EntityConfig; row: Row | null; products: ProductLite[]; linked: string[]; currentUrl: string | null; onCancel: () => void; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const { cfg, row } = props;
  const [f, setF] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = { name: row?.name ?? '' };
    for (const d of cfg.fields) o[d.key] = (row?.[d.key] as string | null) ?? (d.kind === 'select' ? d.options?.[0]?.value ?? '' : '');
    return o;
  });
  const [active, setActive] = useState(row?.active ?? true);
  const [picked, setPicked] = useState<string[]>(props.linked);
  const [img, setImg] = useState<{ file: File | null; removed: boolean }>({ file: null, removed: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const oldPath = (row?.[cfg.imageKey] as string | null) ?? null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (f.name.trim() === '') er.name = t('err.required');
    for (const d of cfg.fields) if (d.required && (f[d.key] ?? '').trim() === '') er[d.key] = t('err.required');
    if (cfg.table === 'campaigns' && f.starts_on && f.ends_on && f.ends_on < f.starts_on) er.ends_on = t('err.dates');
    setErrors(er);
    if (Object.keys(er).length > 0 || !supabase) return;
    setBusy(true);
    setProblem(null);
    const db = supabase;
    let savedId = row?.id ?? '';
    const res = await saveWithImage(cfg.folder, { file: img.file, removed: img.removed, oldPath }, async (path) => {
      const body: Record<string, unknown> = { name: f.name.trim(), active };
      for (const d of cfg.fields) body[d.key] = d.kind === 'select' ? f[d.key] : f[d.key].trim() === '' ? null : f[d.key].trim();
      if (path !== undefined) body[cfg.imageKey] = path;
      if (row) return db.from(cfg.table).update(body).eq('id', row.id);
      const ins = await db.from(cfg.table).insert(body).select('id').single();
      if (!ins.error) savedId = (ins.data as { id: string }).id;
      return { error: ins.error };
    });
    if (!res.ok) {
      setBusy(false);
      if (res.stage === 'write' && res.error.code === '23505') setErrors({ name: t('err.duplicate') });
      else setProblem(res.stage === 'upload' ? t('img.uploadError') : t('common.saveError'));
      return;
    }
    if (cfg.linkProducts && savedId) {
      const add = picked.filter((id) => !props.linked.includes(id));
      const drop = props.linked.filter((id) => !picked.includes(id));
      const a = add.length ? await db.from('campaign_products').insert(add.map((product_id) => ({ campaign_id: savedId, product_id }))) : { error: null };
      const d = drop.length ? await db.from('campaign_products').delete().eq('campaign_id', savedId).in('product_id', drop) : { error: null };
      if (a.error || d.error) { setBusy(false); setProblem(t('common.saveError')); return; }
    }
    setBusy(false);
    await props.onSaved();
  }

  const setKey = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
      <div className="fieldwrap">
        <label className="field"><span>{t('f.name')}</span>
          <input type="text" value={f.name} maxLength={160} onChange={(e) => setKey('name', e.target.value)} required /></label>
        {errors.name && <span className="error small" role="alert">{errors.name}</span>}
      </div>
      {cfg.fields.map((d) => (
        <div className="fieldwrap" key={d.key}>
          <label className="field">
            <span>{t(d.label)}{!d.required && <span className="muted small"> ({t('common.optional')})</span>}</span>
            {d.kind === 'textarea' ? <textarea rows={3} value={f[d.key]} onChange={(e) => setKey(d.key, e.target.value)} />
              : d.kind === 'select' ? <select value={f[d.key]} onChange={(e) => setKey(d.key, e.target.value)}>{d.options?.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}</select>
              : <input type={d.kind === 'date' ? 'date' : 'text'} value={f[d.key]} onChange={(e) => setKey(d.key, e.target.value)} />}
          </label>
          {errors[d.key] && <span className="error small" role="alert">{errors[d.key]}</span>}
        </div>
      ))}
      <ImageField label={cfg.imageLabel} currentUrl={props.currentUrl} hasSaved={!!oldPath} file={img.file} removed={img.removed} disabled={busy} onChange={setImg} />
      {cfg.linkProducts && (
        <fieldset className="linkbox">
          <legend>{t('f.products')}</legend>
          {props.products.length === 0 ? <p className="muted small">{t('ent.noProductsToLink')}</p> : props.products.map((p) => (
            <label key={p.id} className="check"><input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.id] : x.filter((i) => i !== p.id)))} /> {p.name}</label>
          ))}
        </fieldset>
      )}
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t('common.active')}</label>
      {problem && <p className="error" role="alert">{problem}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={props.onCancel} disabled={busy}>{t('common.cancel')}</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</button>
      </div>
    </form>
  );
}
