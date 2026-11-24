-- POLICY TESTS for 0004. Run in the Studio SQL editor AFTER 0001, 0002 and 0004. One transaction, ends with ROLLBACK.
-- Success = the final notice "ALL CATALOGUE POLICY TESTS PASSED"; any failure raises an exception naming the test.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'cat-owner@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 'cat-editor@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c3', 'cat-viewer@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c4', 'cat-inactive@example.invalid');
update public.profiles set role = 'owner',  active = true where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set role = 'editor', active = true where id = '00000000-0000-0000-0000-0000000000c2';
update public.profiles set role = 'viewer', active = true where id = '00000000-0000-0000-0000-0000000000c3';
-- c4 stays an inactive viewer.

-- seed ONE category and ONE product as the database owner (these rows exist only inside this test transaction)
insert into public.categories (id, name) values ('00000000-0000-0000-0000-00000000ca01', 'Test category');
insert into public.products (id, name, category_id) values ('00000000-0000-0000-0000-00000000fa01', 'Test product', '00000000-0000-0000-0000-00000000ca01');

-- A1 anonymous has no access to any catalogue table.
do $$ declare t text; begin
  set local role anon;
  foreach t in array array['categories','suppliers','products','campaigns','campaign_products'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'A1 FAILED: anon read %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  reset role;
end $$;

-- A2 inactive user sees nothing.
do $$ declare n int; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.products;   if n <> 0 then raise exception 'A2 FAILED: inactive user sees products'; end if;
  reset role;
end $$;

-- A3 viewer: reads, cannot insert, update or delete.
do $$ declare n int; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.products;   if n <> 1 then raise exception 'A3a FAILED: viewer cannot read products'; end if;
  begin insert into public.products (name) values ('x'); raise exception 'A3b FAILED: viewer inserted a product';
  exception when insufficient_privilege then null; end;
  update public.products set name = 'hacked';
  get diagnostics n = row_count;                 if n <> 0 then raise exception 'A3c FAILED: viewer updated a product'; end if;
  delete from public.products;
  get diagnostics n = row_count;                 if n <> 0 then raise exception 'A3d FAILED: viewer deleted a product'; end if;
  begin insert into public.categories (name) values ('x'); raise exception 'A3e FAILED: viewer inserted a category';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- A4 editor: full catalogue write, constraints hold, protected columns cannot be set.
do $$ declare n int; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
  set local role authenticated;
  insert into public.categories (name) values ('Rice');
  insert into public.suppliers (name, location) values ('Sup A', 'Addis Ababa');
  insert into public.products (name, category_id, retail_price, sale_price, min_order_quantity, stock_status)
    values ('Rice 25kg', (select id from public.categories where name = 'Rice'), 100.00, 90.00, 10, 'in_stock');
  insert into public.campaigns (name, campaign_type, starts_on, ends_on) values ('Eid', 'seasonal', '2026-12-01', '2026-12-10');
  insert into public.campaign_products (campaign_id, product_id)
    select c.id, p.id from public.campaigns c, public.products p where c.name = 'Eid' and p.name = 'Rice 25kg';
  update public.products set name = 'Rice 50kg' where name = 'Rice 25kg';
  get diagnostics n = row_count;                 if n <> 1 then raise exception 'A4a FAILED: editor could not update'; end if;
  begin insert into public.categories (name) values (' rice '); raise exception 'A4b FAILED: duplicate category name accepted';
  exception when unique_violation then null; end;
  begin insert into public.products (name, retail_price, sale_price) values ('p', 10, 12); raise exception 'A4c FAILED: sale price above retail accepted';
  exception when check_violation then null; end;
  begin insert into public.products (name, sale_price) values ('p', 5); raise exception 'A4d FAILED: sale price without retail accepted';
  exception when check_violation then null; end;
  begin insert into public.products (name, retail_price) values ('p', -1); raise exception 'A4e FAILED: negative price accepted';
  exception when check_violation then null; end;
  begin insert into public.products (name, image_approved) values ('p', true); raise exception 'A4f FAILED: approved without image accepted';
  exception when check_violation then null; end;
  begin insert into public.campaigns (name, starts_on, ends_on) values ('c', '2026-12-10', '2026-12-01'); raise exception 'A4g FAILED: end before start accepted';
  exception when check_violation then null; end;
  begin insert into public.products (name, created_by) values ('p', '00000000-0000-0000-0000-0000000000c1'); raise exception 'A4h FAILED: editor set created_by';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.audit_log;  if n <> 0 then raise exception 'A4i FAILED: editor can read the audit log'; end if;
  delete from public.campaign_products;
  delete from public.campaigns;
  delete from public.products where name = 'Rice 50kg';
  get diagnostics n = row_count;                 if n <> 1 then raise exception 'A4j FAILED: editor could not delete'; end if;
  reset role;
end $$;

-- A5 the audit trail recorded the editor's work (checked as database owner); owner can read it, no one can edit it.
do $$ declare n int; begin
  select count(*) into n from public.audit_log where entity = 'products' and actor = '00000000-0000-0000-0000-0000000000c2';
  if n < 3 then raise exception 'A5a FAILED: expected product audit rows, got %', n; end if;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.audit_log where entity = 'products'; if n < 3 then raise exception 'A5b FAILED: owner cannot read audit'; end if;
  begin update public.audit_log set action = 'x'; raise exception 'A5c FAILED: audit edited';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- A6 storage on source-images: viewers read, editors upload and delete only inside catalogue folders.
do $$ declare n int; begin
  insert into storage.objects (bucket_id, name) values ('source-images', 'products/seed.jpg');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'source-images'; if n <> 1 then raise exception 'A6a FAILED: viewer cannot read images'; end if;
  begin insert into storage.objects (bucket_id, name) values ('source-images', 'products/v.jpg'); raise exception 'A6b FAILED: viewer uploaded';
  exception when insufficient_privilege then null; end;
  delete from storage.objects where name = 'products/seed.jpg';
  get diagnostics n = row_count;                 if n <> 0 then raise exception 'A6c FAILED: viewer deleted an image'; end if;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name) values ('source-images', 'products/e.jpg');
  begin insert into storage.objects (bucket_id, name) values ('source-images', 'secrets/e.jpg'); raise exception 'A6d FAILED: upload outside catalogue folders';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('renders', 'products/e.mp4'); raise exception 'A6e FAILED: upload to another bucket';
  exception when insufficient_privilege then null; end;
  delete from storage.objects where name = 'products/seed.jpg';
  get diagnostics n = row_count;                 if n <> 1 then raise exception 'A6f FAILED: editor could not delete an image'; end if;
  reset role;
  set local role anon;
  begin perform count(*) from storage.objects; raise exception 'A6g FAILED: anon read storage';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

do $$ begin raise notice 'ALL CATALOGUE POLICY TESTS PASSED'; end $$;
rollback;
