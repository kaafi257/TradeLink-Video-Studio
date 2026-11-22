-- POLICY TESTS for 0001. UNTESTED SCRIPT: it was written without access to a Postgres server.
-- Run in the Studio SQL editor AFTER applying 0001. It runs inside a transaction and ends with
-- ROLLBACK, so nothing is kept. Read each result; every check states its expected outcome.
-- If the editor shows only the last result, run the numbered blocks one at a time inside
-- the same BEGIN ... ROLLBACK (select from BEGIN down to the block you want, then Run).

begin;

-- Three throwaway users (removed by the rollback).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'test-owner@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'test-viewer@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 'test-inactive@example.invalid');
update public.profiles set role = 'owner',  active = true  where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'viewer', active = true  where id = '00000000-0000-0000-0000-0000000000a2';
-- a3 stays inactive viewer (the default).

-- T1 anonymous: expect permission denied.
set local role anon;
select count(*) from public.app_settings;   -- EXPECT ERROR: permission denied
reset role;

-- T2 inactive user: sees only their own profile row, no settings.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
select count(*) from public.profiles;       -- EXPECT 1
select count(*) from public.app_settings;   -- EXPECT 0
reset role;

-- T3 viewer: reads settings, cannot change them.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select count(*) from public.app_settings;                         -- EXPECT 1
update public.app_settings set brand_name = 'x' where id = true;   -- EXPECT 0 rows updated
select count(*) from public.audit_log;                            -- EXPECT 0
reset role;

-- T4 owner: can change settings, can read the audit log.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
update public.app_settings set brand_name = 'test' where id = true; -- EXPECT 1 row updated
select count(*) from public.audit_log;                             -- EXPECT 1 or more
-- T5 nobody can alter the audit log, even the owner:
update public.audit_log set action = 'x';                          -- EXPECT ERROR (no privilege)
reset role;

rollback;
