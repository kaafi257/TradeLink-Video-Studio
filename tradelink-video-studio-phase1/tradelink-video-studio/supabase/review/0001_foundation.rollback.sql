-- ROLLBACK for 0001. Only safe BEFORE real data exists. Run in the Studio project only.
drop trigger if exists on_auth_user_created on auth.users;
drop table if exists public.audit_log;
drop table if exists public.app_settings;
drop table if exists public.profiles;
drop function if exists public.log_change();
drop function if exists public.block_audit_changes();
drop function if exists public.stamp_settings();
drop function if exists public.guard_last_owner();
drop function if exists public.handle_new_user();
drop function if exists public.is_editor_or_owner();
drop function if exists public.is_owner();
drop function if exists public.is_member();
drop function if exists public.current_app_role();
drop type if exists public.app_role;
