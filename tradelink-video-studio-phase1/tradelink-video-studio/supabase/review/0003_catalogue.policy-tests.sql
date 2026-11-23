-- POLICY TESTS for 0003. Run in the Studio SQL editor AFTER 0001 and 0003. One transaction, ends with ROLLBACK.
-- Success = the final notice "ALL CATALOGUE TESTS PASSED"; any failure raises an exception naming the test.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'cat-viewer@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'cat-inactive@example.invalid');
update public.profiles set role = 'viewer', active = true where id = '00000000-0000-0000-0000-0000000000b1';

-- C1 a good sync replaces the copy; a failed one (bad payload) leaves it untouched.
do $$ declare r uuid; n int; p jsonb;
begin
  p := '{"public_campaign":[],"public_categories":[],"public_contact":[],"public_industries":[],"public_product_images":[],
         "public_products":[{"id":"p1","name":"A"},{"id":"p2","name":"B"}],"public_promo_products":[],"public_promotions":[],
         "public_supplier_categories":[],"public_suppliers":[]}'::jsonb;
  r := public.catalogue_start_run('manual');
  perform public.catalogue_replace(r, p);
  select count(*) into n from public.catalogue_items; if n <> 2 then raise exception 'C1a FAILED: expected 2 rows, got %', n; end if;

  r := public.catalogue_start_run('manual');
  begin
    perform public.catalogue_replace(r, p - 'public_suppliers');   -- only nine views
    raise exception 'C1b FAILED: nine-view payload accepted';
  exception when raise_exception then
    if sqlerrm like 'C1b%' then raise; end if;
  end;
  select count(*) into n from public.catalogue_items; if n <> 2 then raise exception 'C1c FAILED: previous copy was changed'; end if;
  perform public.catalogue_fail_run(r, 'test');
end $$;

-- C2 only one run at a time.
do $$ begin
  perform public.catalogue_start_run('nightly');
  begin
    perform public.catalogue_start_run('nightly');
    raise exception 'C2 FAILED: two runs at once';
  exception when raise_exception then
    if sqlerrm like 'C2%' then raise; end if;
  end;
end $$;

-- C3 anon cannot read; inactive user sees nothing; viewer can read but not write or call the functions.
do $$ declare n int; begin
  set local role anon;
  begin perform count(*) from public.catalogue_items; raise exception 'C3a FAILED: anon read';
  exception when insufficient_privilege then null; end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
  select count(*) into n from public.catalogue_items; if n <> 0 then raise exception 'C3b FAILED: inactive user reads copy'; end if;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  select count(*) into n from public.catalogue_items; if n <> 2 then raise exception 'C3c FAILED: viewer cannot read copy'; end if;
  begin delete from public.catalogue_items; raise exception 'C3d FAILED: viewer deleted rows';
  exception when insufficient_privilege then null; end;
  begin perform public.catalogue_start_run('manual'); raise exception 'C3e FAILED: viewer started a sync';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

do $$ begin raise notice 'ALL CATALOGUE TESTS PASSED'; end $$;
rollback;
