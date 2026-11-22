-- SELECT-only checks to run AFTER applying 0001. Expected results are in the comments.

-- 1. RLS must be on for all three tables (expect rls_enabled = true for each).
select relname, relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and relname in ('profiles', 'app_settings', 'audit_log');

-- 2. The anon role must have NO privileges on these tables (expect zero rows).
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
  and table_name in ('profiles', 'app_settings', 'audit_log');

-- 3. What authenticated may do (expect: profiles SELECT; app_settings SELECT; audit_log SELECT;
--    plus column-level UPDATE shown in the next query).
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated'
  and table_name in ('profiles', 'app_settings', 'audit_log')
order by table_name, privilege_type;

-- 4. Column-level UPDATE grants for authenticated.
select table_name, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'UPDATE'
  and table_name in ('profiles', 'app_settings', 'audit_log')
order by table_name, column_name;

-- 5. Policies (expect: profiles_select, profiles_update_owner, settings_select,
--    settings_update_owner, audit_select_owner).
select tablename, policyname, cmd, roles
from pg_policies where schemaname = 'public'
  and tablename in ('profiles', 'app_settings', 'audit_log')
order by tablename, policyname;

-- 6. The single settings row exists and is blank (expect one row, text columns null).
select * from public.app_settings;

-- 7. Helper functions are NOT executable by anon (expect anon_can_execute = false for all).
select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('current_app_role', 'is_member', 'is_owner', 'is_editor_or_owner', 'handle_new_user', 'log_change');
