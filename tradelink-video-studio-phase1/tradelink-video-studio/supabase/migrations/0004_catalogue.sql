-- 0004_catalogue: the Studio's own, independent catalogue (Phase 2). FOR OWNER REVIEW. Not applied automatically.
-- Target: the Studio Supabase project ONLY. Requires 0001 and 0002. No marketplace data, no sample rows.
-- Everything the catalogue holds is typed in by the owner or an editor.

-- 0. The marketplace-sync tables from 0003 are no longer used. They are empty; remove them if present.
drop function if exists public.catalogue_fail_run(uuid, text);
drop function if exists public.catalogue_replace(uuid, jsonb);
drop function if exists public.catalogue_start_run(text);
drop table if exists public.catalogue_items;
drop table if exists public.sync_runs;

-- 1. Shared helpers (new functions; the existing log_change / stamp_settings are untouched).
create function public.stamp_catalogue()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- Audit trail for catalogue changes: who, what, which row; column NAMES only, never values.
create function public.log_catalogue_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r jsonb; changed jsonb := '[]'::jsonb;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(n.key), '[]'::jsonb) into changed
      from jsonb_each(to_jsonb(new)) as n
     where n.value is distinct from (to_jsonb(old) -> n.key)
       and n.key not in ('updated_at', 'updated_by');
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, meta)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce(r ->> 'id', (r ->> 'campaign_id') || '/' || (r ->> 'product_id')),
          jsonb_build_object('changed_columns', changed));
  return null;
end;
$$;
revoke all on function public.stamp_catalogue(), public.log_catalogue_change() from public, anon, authenticated;

-- 2. Tables
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 2000),
  image_path  text check (char_length(image_path) <= 300),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);
create unique index categories_name_unique on public.categories (lower(btrim(name)));

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 160),
  logo_path   text check (char_length(logo_path) <= 300),
  industry    text check (char_length(industry) <= 120),
  location    text check (char_length(location) <= 200),
  description text check (char_length(description) <= 2000),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);
create unique index suppliers_name_unique on public.suppliers (lower(btrim(name)));

create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(btrim(name)) between 1 and 200),
  description        text check (char_length(description) <= 4000),
  category_id        uuid references public.categories (id) on delete set null,
  supplier_id        uuid references public.suppliers (id) on delete set null,
  brand              text check (char_length(brand) <= 120),
  unit               text check (char_length(unit) <= 60),
  package_size       text check (char_length(package_size) <= 120),
  min_order_quantity integer check (min_order_quantity > 0),
  retail_price       numeric(12, 2) check (retail_price >= 0),
  sale_price         numeric(12, 2) check (sale_price >= 0),
  stock_status       text not null default 'unknown'
                     check (stock_status in ('in_stock', 'low_stock', 'out_of_stock', 'unknown')),
  stock_quantity     integer check (stock_quantity >= 0),
  image_path         text check (char_length(image_path) <= 300),
  image_approved     boolean not null default false,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id) on delete set null,
  -- A sale price only makes sense next to a retail price, and must be lower.
  constraint products_sale_needs_retail check (sale_price is null or (retail_price is not null and sale_price < retail_price)),
  -- Videos may only use approved images, so approval needs an image.
  constraint products_approved_needs_image check (not image_approved or image_path is not null)
);
create index products_category_idx on public.products (category_id);
create index products_supplier_idx on public.products (supplier_id);

create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 160),
  campaign_type text not null default 'promotion'
                check (campaign_type in ('promotion', 'seasonal', 'new_arrival', 'wholesale_offer', 'clearance', 'other')),
  description   text check (char_length(description) <= 4000),
  banner_path   text check (char_length(banner_path) <= 300),
  starts_on     date,
  ends_on       date,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null,
  constraint campaigns_dates_ordered check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

create table public.campaign_products (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  primary key (campaign_id, product_id)
);

-- 3. Triggers: stamp dates/users, then audit.
do $$
declare t text;
begin
  foreach t in array array['categories', 'suppliers', 'products', 'campaigns'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.stamp_catalogue()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_catalogue_change()', t || '_audit', t);
  end loop;
end $$;
create trigger campaign_products_audit
  after insert or delete on public.campaign_products
  for each row execute function public.log_catalogue_change();

-- 4. Row Level Security: members read; editors and the owner write; viewers are read-only; anon gets nothing.
do $$
declare t text;
begin
  foreach t in array array['categories', 'suppliers', 'products', 'campaigns', 'campaign_products'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member())', t || '_select', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_editor_or_owner())', t || '_delete', t);
  end loop;
end $$;

-- Writes use column lists, so ids, created_* and updated_* can only be set by the triggers.
grant insert (name, description, image_path, active), update (name, description, image_path, active) on public.categories to authenticated;
grant insert (name, logo_path, industry, location, description, active),
      update (name, logo_path, industry, location, description, active) on public.suppliers to authenticated;
grant insert (name, description, category_id, supplier_id, brand, unit, package_size, min_order_quantity, retail_price,
              sale_price, stock_status, stock_quantity, image_path, image_approved, active),
      update (name, description, category_id, supplier_id, brand, unit, package_size, min_order_quantity, retail_price,
              sale_price, stock_status, stock_quantity, image_path, image_approved, active) on public.products to authenticated;
grant insert (name, campaign_type, description, banner_path, starts_on, ends_on, active),
      update (name, campaign_type, description, banner_path, starts_on, ends_on, active) on public.campaigns to authenticated;
grant insert (campaign_id, product_id) on public.campaign_products to authenticated;

do $$
declare t text;
begin
  foreach t in array array['categories', 'suppliers', 'products', 'campaigns'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_editor_or_owner())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_editor_or_owner()) with check (public.is_editor_or_owner())', t || '_update', t);
  end loop;
end $$;
create policy campaign_products_insert on public.campaign_products for insert to authenticated with check (public.is_editor_or_owner());

-- 5. Storage: reuse the private source-images bucket (10 MB; JPEG, PNG, WebP; set in 0002).
-- Files live under products/, categories/, suppliers/ or campaigns/ only.
create policy "members read source images"
  on storage.objects for select to authenticated
  using (bucket_id = 'source-images' and public.is_member());

create policy "editors upload catalogue images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'source-images'
              and (storage.foldername(name))[1] in ('products', 'categories', 'suppliers', 'campaigns')
              and public.is_editor_or_owner());

create policy "editors delete catalogue images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'source-images'
         and (storage.foldername(name))[1] in ('products', 'categories', 'suppliers', 'campaigns')
         and public.is_editor_or_owner());
