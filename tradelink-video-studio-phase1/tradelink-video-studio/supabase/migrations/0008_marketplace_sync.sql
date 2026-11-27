-- 0008_marketplace_sync: read-only copy of categories, suppliers, products and product pictures from the TradeLink
-- marketplace's PUBLIC views into the Studio's own catalogue. FOR OWNER REVIEW. NOT applied automatically.
-- Target: the Studio Supabase project ONLY. Requires 0001, 0002 and 0004.
-- The marketplace is only ever READ (by the sync-marketplace Edge Function, as the signed-in owner). This file
-- touches nothing outside the Studio.
--
-- Rules built into the apply function:
--   * Only the owner can run it (is_owner(), checked here again, not only in the Edge Function).
--   * New items are added. Existing Studio items are never overwritten: only EMPTY fields are filled in.
--   * A marketplace category or supplier whose name already exists in the Studio is linked, not duplicated.
--   * Nothing is ever deleted. Something removed on the marketplace simply stays in the Studio.
--   * A row that fails a rule (too long, bad number, ...) is skipped and reported; the rest continues.

-- 1. Tables ---------------------------------------------------------------------------------------------------
create table public.marketplace_links (
  entity         text not null check (entity in ('categories', 'suppliers', 'products')),
  marketplace_id text not null check (char_length(marketplace_id) between 1 and 80),
  studio_id      uuid not null,
  source_image   text check (char_length(source_image) <= 600),
  synced_at      timestamptz not null default now(),
  primary key (entity, marketplace_id),
  unique (entity, studio_id)
);

create table public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_by  uuid references auth.users (id) on delete set null,
  summary     jsonb not null default '{}'::jsonb,
  error       text check (char_length(error) <= 400)
);
-- Only one sync at a time.
create unique index sync_runs_one_running on public.sync_runs ((true)) where status = 'running';

alter table public.marketplace_links enable row level security;
alter table public.sync_runs enable row level security;
revoke all on public.marketplace_links, public.sync_runs from anon, authenticated;
grant select on public.marketplace_links, public.sync_runs to authenticated;
create policy marketplace_links_select on public.marketplace_links for select to authenticated using (public.is_member());
create policy sync_runs_select on public.sync_runs for select to authenticated using (public.is_member());
-- No insert/update/delete policies: only the functions below (security definer, owner only) can write.

-- 2. Small safe parsers (internal) --------------------------------------------------------------------------
create function public.marketplace_num(p text)
returns numeric language plpgsql immutable set search_path = ''
as $$ begin
  if p is null or btrim(p) = '' then return null; end if;
  return case when p::numeric >= 0 and p::numeric < 1000000000 then round(p::numeric, 2) end;
exception when others then return null; end; $$;

create function public.marketplace_int(p text)
returns integer language plpgsql immutable set search_path = ''
as $$ begin
  if p is null or btrim(p) = '' then return null; end if;
  return case when p::numeric >= 0 and p::numeric < 2000000000 then trunc(p::numeric)::integer end;
exception when others then return null; end; $$;

create function public.marketplace_txt(p text, n int)
returns text language sql immutable set search_path = ''
as $$ select nullif(left(btrim(p), n), '') $$;

create function public.marketplace_url(p text)
returns text language sql immutable set search_path = ''
as $$ select case when btrim(p) ~* '^https://' and char_length(btrim(p)) <= 600 then btrim(p) end $$;

revoke all on function public.marketplace_num(text), public.marketplace_int(text),
  public.marketplace_txt(text, int), public.marketplace_url(text) from public, anon, authenticated;

-- 3. Start / finish a run -------------------------------------------------------------------------------------
create function public.marketplace_start_run()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare rid uuid;
begin
  if not public.is_owner() then raise exception 'Not allowed'; end if;
  -- A run that never finished (the function was cut off) must not block syncing for ever.
  update public.sync_runs set status = 'failed', finished_at = now(), error = 'Timed out'
   where status = 'running' and started_at < now() - interval '15 minutes';
  insert into public.sync_runs (started_by) values (auth.uid()) returning id into rid;
  return rid;
exception when unique_violation then
  raise exception 'A sync is already running';
end;
$$;

create function public.marketplace_finish_run(p_run uuid, p_status text, p_summary jsonb, p_error text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'Not allowed'; end if;
  if p_status not in ('succeeded', 'failed') then raise exception 'Bad status'; end if;
  update public.sync_runs
     set status = p_status, finished_at = now(), summary = coalesce(p_summary, '{}'::jsonb), error = left(p_error, 400)
   where id = p_run and status = 'running';
end;
$$;

-- 4. Apply the copy ---------------------------------------------------------------------------------------------
-- p_payload: { public_industries, public_categories, public_suppliers, public_products, public_product_images }, each a JSON list.
-- Returns { counts, skipped (first 15 reasons), images: [{kind, id, url}] } where images are the Studio items still
-- WITHOUT a picture and the marketplace address of one; the Edge Function copies them into private storage.
create function public.marketplace_apply(p_run uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb; k text; mid text; sid uuid; nm text; ind jsonb := '{}'::jsonb; pimg jsonb;
  cat_new int := 0; cat_linked int := 0; sup_new int := 0; sup_linked int := 0; prod_new int := 0; prod_filled int := 0; skipped int := 0;
  reasons jsonb := '[]'::jsonb; images jsonb := '[]'::jsonb; src text; cur text;
  v_desc text; v_retail numeric; v_sale numeric; v_stock text; v_cat uuid; v_sup uuid;
begin
  if not public.is_owner() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.sync_runs where id = p_run and status = 'running') then raise exception 'No such running sync'; end if;
  foreach k in array array['public_industries', 'public_categories', 'public_suppliers', 'public_products', 'public_product_images'] loop
    if jsonb_typeof(p_payload -> k) is distinct from 'array' then raise exception 'Payload % is not a list', k; end if;
    if jsonb_array_length(p_payload -> k) > 20000 then raise exception 'Payload % is too large', k; end if;
  end loop;

  select coalesce(jsonb_object_agg(i.id, i.name), '{}'::jsonb) into ind
    from jsonb_to_recordset(p_payload -> 'public_industries') as i(id text, name text);

  -- Categories
  for r in select e from jsonb_array_elements(p_payload -> 'public_categories') as t(e) loop
    begin
      mid := r ->> 'id'; nm := public.marketplace_txt(r ->> 'name', 120);
      if mid is null or nm is null then raise exception 'category without id or name'; end if;
      select studio_id into sid from public.marketplace_links where entity = 'categories' and marketplace_id = mid;
      if sid is null then
        select id into sid from public.categories where lower(btrim(name)) = lower(nm);
        if sid is null then
          insert into public.categories (name, description) values (nm, public.marketplace_txt(r ->> 'description', 2000)) returning id into sid;
          cat_new := cat_new + 1;
        else
          cat_linked := cat_linked + 1;
          update public.categories set description = public.marketplace_txt(r ->> 'description', 2000) where id = sid and description is null;
        end if;
        insert into public.marketplace_links (entity, marketplace_id, studio_id, source_image) values ('categories', mid, sid, public.marketplace_url(r ->> 'image_url'));
      else
        update public.categories set description = public.marketplace_txt(r ->> 'description', 2000) where id = sid and description is null;
        update public.marketplace_links set source_image = public.marketplace_url(r ->> 'image_url'), synced_at = now() where entity = 'categories' and marketplace_id = mid;
      end if;
      select image_path into cur from public.categories where id = sid;
      src := public.marketplace_url(r ->> 'image_url');
      if cur is null and src is not null then images := images || jsonb_build_object('kind', 'categories', 'id', sid, 'url', src); end if;
    exception when others then
      skipped := skipped + 1;
      if jsonb_array_length(reasons) < 15 then reasons := reasons || to_jsonb('category ' || coalesce(mid, '?') || ': ' || left(sqlerrm, 120)); end if;
    end;
  end loop;

  -- Suppliers
  for r in select e from jsonb_array_elements(p_payload -> 'public_suppliers') as t(e) loop
    begin
      mid := r ->> 'id'; nm := public.marketplace_txt(r ->> 'name', 160);
      if mid is null or nm is null then raise exception 'supplier without id or name'; end if;
      select studio_id into sid from public.marketplace_links where entity = 'suppliers' and marketplace_id = mid;
      if sid is null then
        select id into sid from public.suppliers where lower(btrim(name)) = lower(nm);
        if sid is null then
          insert into public.suppliers (name, industry, location, description)
          values (nm, public.marketplace_txt(ind ->> (r ->> 'industry_id'), 120), public.marketplace_txt(r ->> 'location', 200), public.marketplace_txt(r ->> 'about', 2000))
          returning id into sid;
          sup_new := sup_new + 1;
        else
          sup_linked := sup_linked + 1;
          update public.suppliers set
            industry = coalesce(industry, public.marketplace_txt(ind ->> (r ->> 'industry_id'), 120)),
            location = coalesce(location, public.marketplace_txt(r ->> 'location', 200)),
            description = coalesce(description, public.marketplace_txt(r ->> 'about', 2000))
          where id = sid;
        end if;
        insert into public.marketplace_links (entity, marketplace_id, studio_id, source_image) values ('suppliers', mid, sid, left(r ->> 'logo_path', 600));
      else
        update public.suppliers set
          industry = coalesce(industry, public.marketplace_txt(ind ->> (r ->> 'industry_id'), 120)),
          location = coalesce(location, public.marketplace_txt(r ->> 'location', 200)),
          description = coalesce(description, public.marketplace_txt(r ->> 'about', 2000))
        where id = sid;
        update public.marketplace_links set source_image = left(r ->> 'logo_path', 600), synced_at = now() where entity = 'suppliers' and marketplace_id = mid;
      end if;
      select logo_path into cur from public.suppliers where id = sid;
      src := nullif(btrim(r ->> 'logo_path'), '');
      if cur is null and src is not null then images := images || jsonb_build_object('kind', 'suppliers', 'id', sid, 'url', left(src, 600)); end if;
    exception when others then
      skipped := skipped + 1;
      if jsonb_array_length(reasons) < 15 then reasons := reasons || to_jsonb('supplier ' || coalesce(mid, '?') || ': ' || left(sqlerrm, 120)); end if;
    end;
  end loop;

  -- First picture of each product (lowest sort_order)
  select coalesce(jsonb_object_agg(d.product_id, d.url), '{}'::jsonb) into pimg
    from (select distinct on (x.product_id) x.product_id, x.url
            from jsonb_to_recordset(p_payload -> 'public_product_images') as x(product_id text, url text, sort_order text)
           where x.product_id is not null and x.url is not null
           order by x.product_id, public.marketplace_int(x.sort_order) nulls last, x.url) d;

  -- Products
  for r in select e from jsonb_array_elements(p_payload -> 'public_products') as t(e) loop
    begin
      mid := r ->> 'id'; nm := public.marketplace_txt(r ->> 'name', 200);
      if mid is null or nm is null then raise exception 'product without id or name'; end if;
      select studio_id into v_cat from public.marketplace_links where entity = 'categories' and marketplace_id = (r ->> 'category_id');
      select studio_id into v_sup from public.marketplace_links where entity = 'suppliers' and marketplace_id = (r ->> 'supplier_id');
      v_desc := public.marketplace_txt(r ->> 'description', 4000);
      v_retail := public.marketplace_num(r ->> 'retail_price');
      v_sale := public.marketplace_num(r ->> 'sale_price');
      v_stock := case when lower(replace(coalesce(r ->> 'stock_status', ''), ' ', '_')) in ('in_stock', 'low_stock', 'out_of_stock')
                      then lower(replace(r ->> 'stock_status', ' ', '_')) else 'unknown' end;
      select studio_id into sid from public.marketplace_links where entity = 'products' and marketplace_id = mid;
      if sid is null then
        insert into public.products (name, description, category_id, supplier_id, brand, unit, package_size, min_order_quantity,
                                     retail_price, sale_price, stock_status, stock_quantity)
        values (nm, v_desc, v_cat, v_sup, public.marketplace_txt(r ->> 'brand', 120), public.marketplace_txt(r ->> 'unit', 60),
                public.marketplace_txt(r ->> 'package_size', 120),
                case when public.marketplace_int(r ->> 'min_order_quantity') > 0 then public.marketplace_int(r ->> 'min_order_quantity') end,
                v_retail, case when v_retail is not null and v_sale < v_retail then v_sale end, v_stock, public.marketplace_int(r ->> 'stock_left'))
        returning id into sid;
        insert into public.marketplace_links (entity, marketplace_id, studio_id) values ('products', mid, sid);
        prod_new := prod_new + 1;
      else
        -- Existing product: ONLY empty fields are filled. Anything typed in the Studio stays.
        update public.products set
          description = coalesce(description, v_desc),
          category_id = coalesce(category_id, v_cat),
          supplier_id = coalesce(supplier_id, v_sup),
          brand = coalesce(brand, public.marketplace_txt(r ->> 'brand', 120)),
          unit = coalesce(unit, public.marketplace_txt(r ->> 'unit', 60)),
          package_size = coalesce(package_size, public.marketplace_txt(r ->> 'package_size', 120)),
          min_order_quantity = coalesce(min_order_quantity, case when public.marketplace_int(r ->> 'min_order_quantity') > 0 then public.marketplace_int(r ->> 'min_order_quantity') end),
          sale_price = case when sale_price is null and v_sale is not null and coalesce(retail_price, v_retail) is not null and v_sale < coalesce(retail_price, v_retail) then v_sale else sale_price end,
          retail_price = coalesce(retail_price, v_retail),
          stock_status = case when stock_status = 'unknown' then v_stock else stock_status end,
          stock_quantity = coalesce(stock_quantity, public.marketplace_int(r ->> 'stock_left'))
        where id = sid;
        prod_filled := prod_filled + 1;
      end if;
      src := coalesce(public.marketplace_url(r ->> 'image_url'), public.marketplace_url(pimg ->> mid));
      update public.marketplace_links set source_image = src, synced_at = now() where entity = 'products' and marketplace_id = mid;
      select image_path into cur from public.products where id = sid;
      if cur is null and src is not null then images := images || jsonb_build_object('kind', 'products', 'id', sid, 'url', src); end if;
    exception when others then
      skipped := skipped + 1;
      if jsonb_array_length(reasons) < 15 then reasons := reasons || to_jsonb('product ' || coalesce(mid, '?') || ': ' || left(sqlerrm, 120)); end if;
    end;
  end loop;

  return jsonb_build_object(
    'counts', jsonb_build_object('categories_new', cat_new, 'categories_linked', cat_linked, 'suppliers_new', sup_new,
                                 'suppliers_linked', sup_linked, 'products_new', prod_new, 'products_checked', prod_filled, 'rows_skipped', skipped),
    'skipped', reasons, 'images', images);
end;
$$;

revoke all on function public.marketplace_start_run(), public.marketplace_finish_run(uuid, text, jsonb, text),
  public.marketplace_apply(uuid, jsonb) from public, anon;
grant execute on function public.marketplace_start_run(), public.marketplace_finish_run(uuid, text, jsonb, text),
  public.marketplace_apply(uuid, jsonb) to authenticated;
