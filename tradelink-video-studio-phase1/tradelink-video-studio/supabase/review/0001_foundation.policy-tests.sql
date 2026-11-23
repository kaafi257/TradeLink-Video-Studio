-- POLICY TESTS for 0001. NOT YET RUN against a real Postgres: run it once in the Studio SQL editor
-- AFTER applying 0001. Everything happens inside one transaction that ends with ROLLBACK, so nothing is kept.
-- Each check is a DO block that RAISES an exception on failure. Success looks like the final
-- notice "ALL POLICY TESTS PASSED". Any exception text names the failing test. (An expected
-- permission error is caught inside its block, so it no longer aborts the whole script.)

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'test-owner@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'test-viewer@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 'test-inactive@example.invalid');
update public.profiles set role = 'owner',  active = true where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'viewer', active = true where id = '00000000-0000-0000-0000-0000000000a2';
-- a3 stays an inactive viewer (the default).

-- T1 anonymous: no access to any table.
do $$ begin
  set local role anon;
  begin
    perform count(*) from public.app_settings;
    raise exception 'T1 FAILED: anon could read app_settings';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- T2 inactive user: sees only their own profile, no settings.
do $$ declare n int; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
  select count(*) into n from public.profiles;      if n <> 1 then raise exception 'T2a FAILED: inactive user sees % profiles', n; end if;
  select count(*) into n from public.app_settings;  if n <> 0 then raise exception 'T2b FAILED: inactive user sees settings'; end if;
  reset role;
end $$;

-- T3 viewer: reads settings, cannot change settings, cannot promote self, cannot read audit log.
do $$ declare n int; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
  select count(*) into n from public.app_settings;  if n <> 1 then raise exception 'T3a FAILED: viewer cannot read settings'; end if;
  update public.app_settings set brand_name = 'x' where id = true;
  get diagnostics n = row_count;                    if n <> 0 then raise exception 'T3b FAILED: viewer changed settings'; end if;
  update public.profiles set role = 'owner' where id = '00000000-0000-0000-0000-0000000000a2';
  get diagnostics n = row_count;                    if n <> 0 then raise exception 'T3c FAILED: viewer promoted self'; end if;
  select count(*) into n from public.audit_log;     if n <> 0 then raise exception 'T3d FAILED: viewer reads audit log'; end if;
  reset role;
end $$;

-- T4 owner: changes settings, reads audit log, cannot edit it.
do $$ declare n int; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  update public.app_settings set brand_name = 'test' where id = true;
  get diagnostics n = row_count;                    if n <> 1 then raise exception 'T4a FAILED: owner could not change settings'; end if;
  select count(*) into n from public.audit_log;     if n < 1 then raise exception 'T4b FAILED: no audit row written'; end if;
  begin
    update public.audit_log set action = 'x';
    raise exception 'T4c FAILED: owner edited audit log';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- T5 the last active owner cannot be demoted.
do $$ begin
  begin
    update public.profiles set role = 'viewer' where id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'T5 FAILED: last owner was demoted';
  exception when raise_exception then
    if sqlerrm not like 'The last active owner%' then raise; end if;
  end;
end $$;

do $$ begin raise notice 'ALL POLICY TESTS PASSED'; end $$;

rollback;
