-- 0003_catalogue: read-only copy of the TradeLink public catalogue (Phase 2).
-- FOR OWNER REVIEW. Not applied automatically. Target: the Studio Supabase project ONLY.
-- Requires 0001. The copy is written only by the sync-catalogue Edge Function (service role).
-- The whole copy is replaced in ONE transaction, so a failed sync leaves the previous copy untouched.

create table public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  trigger     text not null check (trigger in ('manual', 'nightly')),
  status      text not null default 'running' check (status in ('running', 'ok', 'failed')),
  counts      jsonb not null default '{}'::jsonb,
  error       text check (char_length(error) <= 500)
);
alter table public.sync_runs enable row level security;
-- At most one running sync at a time.
create unique index sync_runs_one_running on public.sync_runs ((true)) where status = 'running';

create table public.catalogue_items (
  view_name text   not null check (view_name in (
    'public_campaign', 'public_categories', 'public_contact', 'public_industries', 'public_product_images',
    'public_products', 'public_promo_products', 'public_promotions', 'public_supplier_categories', 'public_suppliers')),
  position  int    not null,
  data      jsonb  not null check (jsonb_typeof(data) = 'object'),
  primary key (view_name, position)
);
alter table public.catalogue_items enable row level security;

create policy sync_runs_select on public.sync_runs for select to authenticated using (public.is_member());
create policy catalogue_select on public.catalogue_items for select to authenticated using (public.is_member());

revoke all on public.sync_runs, public.catalogue_items from anon, authenticated;
grant select on public.sync_runs, public.catalogue_items to authenticated;

-- Start a run. Runs stuck for more than 15 minutes are closed as failed first. Fails if one is really running.
create function public.catalogue_start_run(p_trigger text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  update public.sync_runs set status = 'failed', finished_at = now(), error = 'Timed out'
   where status = 'running' and started_at < now() - interval '15 minutes';
  insert into public.sync_runs (trigger) values (p_trigger) returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'A sync is already running';
end;
$$;

-- Replace the whole copy atomically. p_payload is {"public_products": [ {...}, ... ], ...} with all ten views.
create function public.catalogue_replace(p_run uuid, p_payload jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v text; v_counts jsonb := '{}'::jsonb; v_n int;
begin
  if not exists (select 1 from public.sync_runs where id = p_run and status = 'running') then
    raise exception 'No running sync with that id';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'Payload must be an object'; end if;
  if (select count(*) from jsonb_object_keys(p_payload)) <> 10 then raise exception 'Payload must hold exactly the ten views'; end if;

  delete from public.catalogue_items;
  for v in select jsonb_object_keys(p_payload) loop
    if jsonb_typeof(p_payload -> v) <> 'array' then raise exception '% must be a list', v; end if;
    insert into public.catalogue_items (view_name, position, data)
    select v, (e.ord - 1)::int, e.item from jsonb_array_elements(p_payload -> v) with ordinality as e(item, ord);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(v, v_n);
  end loop;
  update public.sync_runs set status = 'ok', finished_at = now(), counts = v_counts where id = p_run;
end;
$$;

create function public.catalogue_fail_run(p_run uuid, p_error text)
returns void
language sql security definer set search_path = ''
as $$
  update public.sync_runs set status = 'failed', finished_at = now(), error = left(p_error, 500)
   where id = p_run and status = 'running';
$$;

-- Only the service role (the Edge Function) may call these.
revoke all on function public.catalogue_start_run(text), public.catalogue_replace(uuid, jsonb),
  public.catalogue_fail_run(uuid, text) from public, anon, authenticated;
grant execute on function public.catalogue_start_run(text), public.catalogue_replace(uuid, jsonb),
  public.catalogue_fail_run(uuid, text) to service_role;
