-- POLICY TESTS for 0008 (run after 0001, 0002, 0004, 0008). One transaction, ends with ROLLBACK; saves nothing.
-- Success = a result row "ALL MARKETPLACE SYNC TESTS PASSED". Any failure raises an exception naming the test.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'ms-owner@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 'ms-editor@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c3', 'ms-viewer@example.invalid');
update public.profiles set role = 'owner',  active = true where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set role = 'editor', active = true where id = '00000000-0000-0000-0000-0000000000c2';
update public.profiles set role = 'viewer', active = true where id = '00000000-0000-0000-0000-0000000000c3';

-- A Studio category typed by hand BEFORE the first sync, and a Studio product the owner already edited.
insert into public.categories (id, name) values ('00000000-0000-0000-0000-00000000c701', 'Beverages');
insert into public.products (id, name, description, retail_price, image_path, image_approved) values
  ('00000000-0000-0000-0000-00000000c702', 'Edited by owner', 'My own words', 99.00, 'products/mine.jpg', false);
insert into public.marketplace_links (entity, marketplace_id, studio_id) values ('products', 'p-existing', '00000000-0000-0000-0000-00000000c702');

create temp table t_payload as select jsonb_build_object(
  'public_industries', '[{"id":"i1","name":"Food"}]'::jsonb,
  'public_categories', '[{"id":"c1","name":"  beverages ","description":"Drinks","image_url":"https://m.example.com/storage/v1/object/public/product-images/cat.jpg"},{"id":"c2","name":"Snacks","description":null,"image_url":null},{"id":"c3","name":"   "}]'::jsonb,
  'public_suppliers', '[{"id":"s1","name":"Acme Foods","industry_id":"i1","location":"Addis Ababa","about":"We supply","logo_path":"acme/logo.png"}]'::jsonb,
  'public_products', '[
     {"id":"p1","name":"Tea 100g","category_id":"c2","supplier_id":"s1","brand":"Acme","unit":"pcs","package_size":"100g","min_order_quantity":"10","retail_price":"80.50","sale_price":"70","stock_status":"In stock","stock_left":"25","image_url":null,"description":"Black tea"},
     {"id":"p2","name":"Bad price","retail_price":"abc","sale_price":"-5","min_order_quantity":0,"stock_status":"weird"},
     {"id":"p3","name":"Sale too high","retail_price":"50","sale_price":"60"},
     {"id":"p4","name":"","retail_price":"5"},
     {"id":"p-existing","name":"Marketplace name","description":"Marketplace words","retail_price":"10","brand":"BrandX","image_url":"https://m.example.com/storage/v1/object/public/product-images/new.jpg"}
   ]'::jsonb,
  'public_product_images', '[{"product_id":"p1","url":"https://m.example.com/storage/v1/object/public/product-images/p1b.jpg","sort_order":"2"},{"product_id":"p1","url":"https://m.example.com/storage/v1/object/public/product-images/p1a.jpg","sort_order":"1"}]'::jsonb
) as p;
grant select on t_payload to authenticated;

-- E1 permissions on starting a run
do $$ declare rid uuid; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
  set local role authenticated;
  begin perform public.marketplace_start_run(); raise exception 'E1a FAILED: editor started a sync';
  exception when raise_exception then if sqlerrm like 'E1%' then raise; end if; end;
  begin perform public.marketplace_apply(gen_random_uuid(), '{}'::jsonb); raise exception 'E1b FAILED: editor applied';
  exception when raise_exception then if sqlerrm like 'E1%' then raise; end if; end;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
  begin perform public.marketplace_start_run(); raise exception 'E1c FAILED: viewer started a sync';
  exception when raise_exception then if sqlerrm like 'E1%' then raise; end if; end;
  reset role;
end $$;

-- E2 owner syncs
do $$ declare rid uuid; res jsonb; c jsonb; imgs jsonb; n int; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  set local role authenticated;
  rid := public.marketplace_start_run();
  begin perform public.marketplace_start_run(); raise exception 'E2a FAILED: two syncs at once';
  exception when raise_exception then if sqlerrm like 'E2%' then raise; end if; end;
  res := public.marketplace_apply(rid, (select p from t_payload));
  c := res -> 'counts';
  if (c ->> 'categories_new')::int <> 1 or (c ->> 'categories_linked')::int <> 1 then raise exception 'E2b FAILED: categories %', c; end if;
  if (select count(*) from public.categories where lower(btrim(name)) = 'beverages') <> 1 then raise exception 'E2c FAILED: duplicate Beverages'; end if;
  if (c ->> 'suppliers_new')::int <> 1 or (select industry from public.suppliers where name = 'Acme Foods') is distinct from 'Food' then raise exception 'E2d FAILED: supplier'; end if;
  -- p1 mapped fully
  select count(*) into n from public.products p where p.name = 'Tea 100g' and p.retail_price = 80.50 and p.sale_price = 70
     and p.min_order_quantity = 10 and p.stock_status = 'in_stock' and p.stock_quantity = 25 and p.brand = 'Acme'
     and p.category_id = (select id from public.categories where name = 'Snacks')
     and p.supplier_id = (select id from public.suppliers where name = 'Acme Foods') and p.image_path is null and p.image_approved = false;
  if n <> 1 then raise exception 'E2e FAILED: product p1 not mapped right'; end if;
  -- bad price and weird stock are cleaned, not fatal
  select count(*) into n from public.products p where p.name = 'Bad price' and p.retail_price is null and p.sale_price is null and p.min_order_quantity is null and p.stock_status = 'unknown';
  if n <> 1 then raise exception 'E2f FAILED: bad numbers not cleaned'; end if;
  -- sale >= retail is dropped
  select count(*) into n from public.products p where p.name = 'Sale too high' and p.retail_price = 50 and p.sale_price is null;
  if n <> 1 then raise exception 'E2g FAILED: sale price kept above retail'; end if;
  -- empty names are skipped and reported, the rest went on
  if (c ->> 'rows_skipped')::int <> 2 or jsonb_array_length(res -> 'skipped') <> 2 then raise exception 'E2h FAILED: skipped %', c; end if;
  -- picture jobs: category image, supplier logo, p1 first picture (sort 1), p-existing is NOT listed (already has an image)
  imgs := res -> 'images';
  if not exists (select 1 from jsonb_array_elements(imgs) e where e ->> 'kind' = 'categories' and e ->> 'url' like '%cat.jpg') then raise exception 'E2i FAILED: category picture missing'; end if;
  if not exists (select 1 from jsonb_array_elements(imgs) e where e ->> 'kind' = 'suppliers' and e ->> 'url' = 'acme/logo.png') then raise exception 'E2j FAILED: logo missing'; end if;
  if not exists (select 1 from jsonb_array_elements(imgs) e where e ->> 'kind' = 'products' and e ->> 'url' like '%p1a.jpg') then raise exception 'E2k FAILED: first product picture missing'; end if;
  if exists (select 1 from jsonb_array_elements(imgs) e where e ->> 'id' = '00000000-0000-0000-0000-00000000c702') then raise exception 'E2l FAILED: item with a picture listed'; end if;
  -- the owner's edits survive; only empty fields are filled
  select count(*) into n from public.products p where p.id = '00000000-0000-0000-0000-00000000c702'
     and p.name = 'Edited by owner' and p.description = 'My own words' and p.retail_price = 99.00 and p.brand = 'BrandX' and p.image_path = 'products/mine.jpg' and p.image_approved = false;
  if n <> 1 then raise exception 'E2m FAILED: an owner edit was overwritten or empty field not filled'; end if;
  perform public.marketplace_finish_run(rid, 'succeeded', res -> 'counts', null);
  begin perform public.marketplace_apply(rid, (select p from t_payload)); raise exception 'E2n FAILED: apply on a finished run';
  exception when raise_exception then if sqlerrm like 'E2%' then raise; end if; end;
  reset role;
end $$;

-- E3 a second sync changes nothing new (idempotent)
do $$ declare rid uuid; res jsonb; before_n int; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into before_n from public.products;
  rid := public.marketplace_start_run();
  res := public.marketplace_apply(rid, (select p from t_payload));
  if (res -> 'counts' ->> 'products_new')::int <> 0 or (res -> 'counts' ->> 'categories_new')::int <> 0 or (res -> 'counts' ->> 'suppliers_new')::int <> 0 then raise exception 'E3a FAILED: duplicates created %', res -> 'counts'; end if;
  if (select count(*) from public.products) <> before_n then raise exception 'E3b FAILED: product count changed'; end if;
  perform public.marketplace_finish_run(rid, 'failed', '{}'::jsonb, 'test');
  -- E4 a bad payload is refused
  rid := public.marketplace_start_run();
  begin perform public.marketplace_apply(rid, '{"public_industries":{}}'::jsonb); raise exception 'E4 FAILED: bad payload accepted';
  exception when raise_exception then if sqlerrm like 'E4%' then raise; end if; end;
  perform public.marketplace_finish_run(rid, 'failed', '{}'::jsonb, 'test');
  reset role;
end $$;

-- E5 read access: members read, nobody writes directly, anon sees nothing
do $$ declare n int; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.sync_runs; if n < 2 then raise exception 'E5a FAILED: viewer cannot read runs'; end if;
  select count(*) into n from public.marketplace_links; if n < 3 then raise exception 'E5b FAILED: viewer cannot read links'; end if;
  begin insert into public.sync_runs (status) values ('succeeded'); raise exception 'E5c FAILED: viewer inserted a run';
  exception when insufficient_privilege then null; end;
  begin delete from public.marketplace_links; raise exception 'E5d FAILED: viewer deleted links';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin perform 1 from public.sync_runs; raise exception 'E5e FAILED: anon read runs';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

select 'ALL MARKETPLACE SYNC TESTS PASSED' as result;
rollback;
