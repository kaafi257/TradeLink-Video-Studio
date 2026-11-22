-- 0001_foundation: roles, profiles, settings, audit log.
-- FOR OWNER REVIEW. Not applied automatically. Target: the Studio Supabase project ONLY.
-- Never run this in the TradeLink marketplace project.
-- Companion files (outside this folder so no tool applies them):
--   supabase/review/0001_foundation.verify.sql, .rollback.sql, .policy-tests.sql, activate-owner.sql

create type public.app_role as enum ('owner', 'editor', 'viewer');

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text check (char_length(full_name) <= 120),
  role       public.app_role not null default 'viewer',
  active     boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ------------------------------------------------------- helper functions
-- Each returns data about the CALLING user only, and only for an ACTIVE profile.
create function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create function public.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_app_role() is not null
$$;

create function public.is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'owner', false)
$$;

create function public.is_editor_or_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('owner', 'editor'), false)
$$;

revoke all on function public.current_app_role(), public.is_member(),
  public.is_owner(), public.is_editor_or_owner() from public, anon;
grant execute on function public.current_app_role(), public.is_member(),
  public.is_owner(), public.is_editor_or_owner() to authenticated;

-- ------------------------------------------- new auth users start INACTIVE
create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(new.raw_user_meta_data ->> 'full_name', 120))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------- never lose the last active owner
create function public.guard_last_owner()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.role = 'owner' and old.active and (new.role <> 'owner' or not new.active) then
    if not exists (
      select 1 from public.profiles p
      where p.role = 'owner' and p.active and p.id <> old.id
    ) then
      raise exception 'The last active owner cannot be demoted or deactivated';
    end if;
  end if;
  return new;
end;
$$;
create trigger profiles_guard_last_owner
  before update on public.profiles
  for each row execute function public.guard_last_owner();

-- -------------------------------------------------------- profile policies
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_owner());
create policy profiles_update_owner on public.profiles for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
-- No insert or delete policy: rows are created by the trigger and removed with the auth user.

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, role, active) on public.profiles to authenticated;

-- ------------------------------------------------------------ app_settings
-- One row only. Every text column is blank until the owner fills it in.
create table public.app_settings (
  id                   boolean primary key default true check (id),
  brand_name           text check (char_length(brand_name) <= 200),
  site_address         text check (char_length(site_address) <= 200),
  tiktok_handle        text check (char_length(tiktok_handle) <= 200),
  default_language     text check (default_language in ('en', 'am')),
  cta_whatsapp         text check (char_length(cta_whatsapp) <= 200),
  cta_telegram         text check (char_length(cta_telegram) <= 200),
  cta_phone            text check (char_length(cta_phone) <= 200),
  cta_website          text check (char_length(cta_website) <= 200),
  nightly_sync_enabled boolean not null default false,  -- used from Phase 2; not editable yet
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id)
);
alter table public.app_settings enable row level security;
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

create function public.stamp_settings()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger app_settings_stamp
  before update on public.app_settings
  for each row execute function public.stamp_settings();

create policy settings_select on public.app_settings for select to authenticated
  using (public.is_member());
create policy settings_update_owner on public.app_settings for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
grant update (brand_name, site_address, tiktok_handle, default_language,
              cta_whatsapp, cta_telegram, cta_phone, cta_website)
  on public.app_settings to authenticated;

-- --------------------------------------------------------------- audit_log
create table public.audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     uuid,
  action    text not null,
  entity    text not null,
  entity_id text,
  meta      jsonb not null default '{}'::jsonb
);
alter table public.audit_log enable row level security;

create policy audit_select_owner on public.audit_log for select to authenticated
  using (public.is_owner());

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create function public.block_audit_changes()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;
create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.block_audit_changes();

-- Record WHICH columns changed (names only, never values).
create function public.log_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_log (actor, action, entity, entity_id, meta)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    case when tg_table_name = 'profiles' then new.id::text else 'singleton' end,
    jsonb_build_object('changed_columns', (
      select coalesce(jsonb_agg(n.key), '[]'::jsonb)
      from jsonb_each(to_jsonb(new)) as n
      where n.value is distinct from (to_jsonb(old) -> n.key)
    ))
  );
  return new;
end;
$$;
revoke all on function public.log_change() from public, anon, authenticated;

create trigger profiles_audit
  after update on public.profiles
  for each row execute function public.log_change();
create trigger app_settings_audit
  after update on public.app_settings
  for each row execute function public.log_change();
