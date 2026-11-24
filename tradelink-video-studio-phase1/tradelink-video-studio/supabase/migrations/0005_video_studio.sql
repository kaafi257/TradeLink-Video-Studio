-- 0005_video_studio: video projects, scenes, render jobs, status history, renderer account (Phase 3, Stage 1).
-- FOR OWNER REVIEW. Not applied automatically. Target: the Studio Supabase project ONLY.
-- Requires 0001, 0002 and 0004. No marketplace data, no sample rows, no service-role key anywhere.
--
-- Who can do what
--   owner / editor : create and edit draft videos, queue them, cancel, archive, mark "Published manually".
--   viewer         : read only.
--   renderer       : a separate low-privilege Supabase login (listed in renderer_accounts) used ONLY by the local
--                    Windows renderer. It has no catalogue access. It can claim queued jobs, read the images the job
--                    needs, upload the MP4 and cover to its own project folder, and report success or failure
--                    through three functions. Only those functions can set "Rendering" or "Ready to post", and
--                    "Ready to post" is refused unless the reported ffprobe facts match the required format.

-- 1. Renderer registry and helper ------------------------------------------------------------------------------
create table public.renderer_accounts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  label      text not null check (char_length(btrim(label)) between 1 and 80),
  created_at timestamptz not null default now()
);
alter table public.renderer_accounts enable row level security;
revoke all on public.renderer_accounts from anon, authenticated;
grant select on public.renderer_accounts to authenticated;
create policy renderer_accounts_select on public.renderer_accounts for select to authenticated
  using (public.is_owner());
-- Rows are added by the owner in the SQL editor (see docs/PHASE-3.md); the app and the API cannot write them.

create function public.is_renderer()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.renderer_accounts r where r.user_id = auth.uid())
$$;
revoke all on function public.is_renderer() from public, anon;
grant execute on function public.is_renderer() to authenticated;

-- 2. Supplier consent (Supplier Spotlight stays blocked until a consent is recorded) ----------------------------
create table public.supplier_consents (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  note        text not null check (char_length(btrim(note)) between 1 and 500),
  given_on    date not null,
  withdrawn   boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);
create index supplier_consents_supplier_idx on public.supplier_consents (supplier_id);

-- 3. Video projects --------------------------------------------------------------------------------------------
create table public.video_projects (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null check (char_length(btrim(title)) between 1 and 160),
  video_type          text not null
                      check (video_type in ('product_showcase', 'wholesale_offer', 'supplier_spotlight', 'campaign_promotion')),
  product_id          uuid references public.products (id) on delete restrict,
  supplier_id         uuid references public.suppliers (id) on delete restrict,
  campaign_id         uuid references public.campaigns (id) on delete restrict,
  language            text not null default 'en' check (language in ('en', 'am')),
  duration_seconds    integer not null default 20 check (duration_seconds in (15, 20, 30)),
  style               text not null default 'premium' check (style in ('premium', 'dynamic', 'minimal')),
  cta_type            text not null check (cta_type in ('whatsapp', 'telegram', 'phone', 'website')),
  cta_value           text not null check (char_length(btrim(cta_value)) between 1 and 200),
  caption             text check (char_length(caption) <= 2200),
  hashtags            text[] not null default '{}' check (cardinality(hashtags) <= 30),
  suggested_post_time text check (char_length(suggested_post_time) <= 120),
  status              text not null default 'draft'
                      check (status in ('draft', 'queued', 'rendering', 'failed', 'ready_to_post', 'published_manually', 'archived')),
  status_note         text check (char_length(status_note) <= 500),
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,
  -- Each type needs its own subject. Product and wholesale videos use an approved product.
  constraint video_subject_present check (
    (video_type in ('product_showcase', 'wholesale_offer') and product_id is not null)
    or (video_type = 'supplier_spotlight' and supplier_id is not null)
    or (video_type = 'campaign_promotion' and campaign_id is not null)
  )
);
create index video_projects_status_idx on public.video_projects (status);
create index video_projects_product_idx on public.video_projects (product_id);

create table public.video_scenes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.video_projects (id) on delete cascade,
  position    integer not null check (position >= 1),
  scene_type  text not null
              check (scene_type in ('intro', 'product', 'price', 'wholesale', 'supplier', 'campaign', 'cta', 'outro')),
  duration_ms integer not null check (duration_ms between 1000 and 15000),
  headline    text check (char_length(headline) <= 200),
  body        text check (char_length(body) <= 500),
  image_path  text check (char_length(image_path) <= 300),
  animation   text not null default 'fade'
              check (animation in ('none', 'fade', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'slide_up', 'slide_left', 'reveal')),
  -- Which approved catalogue field each text came from, e.g. {"headline":"product.name"}. Typed text is marked "typed".
  source      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  unique (project_id, position)
);

create table public.render_jobs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.video_projects (id) on delete cascade,
  status          text not null default 'queued' check (status in ('queued', 'rendering', 'succeeded', 'failed', 'cancelled')),
  attempt         integer not null default 0 check (attempt >= 0),
  max_attempts    integer not null default 3 check (max_attempts between 1 and 5),
  expected_ms     integer not null check (expected_ms > 0),
  plan            jsonb not null,                     -- frozen copy of the project and scenes at queue time
  error_message   text check (char_length(error_message) <= 500),
  output_path     text check (char_length(output_path) <= 300),
  cover_path      text check (char_length(cover_path) <= 300),
  probe           jsonb,                              -- ffprobe facts the renderer reported
  requested_by    uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  finished_at     timestamptz
);
create index render_jobs_status_idx on public.render_jobs (status, created_at);
create index render_jobs_project_idx on public.render_jobs (project_id);

create table public.video_status_history (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references public.video_projects (id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid,
  note        text,
  at          timestamptz not null default now()
);
create index video_status_history_project_idx on public.video_status_history (project_id, at);

-- 4. Triggers --------------------------------------------------------------------------------------------------
create trigger supplier_consents_stamp before insert or update on public.supplier_consents
  for each row execute function public.stamp_catalogue();
create trigger supplier_consents_audit after insert or update or delete on public.supplier_consents
  for each row execute function public.log_catalogue_change();
create trigger video_projects_stamp before insert or update on public.video_projects
  for each row execute function public.stamp_catalogue();
create trigger video_projects_audit after insert or update or delete on public.video_projects
  for each row execute function public.log_catalogue_change();
create trigger video_scenes_stamp before insert or update on public.video_scenes
  for each row execute function public.stamp_catalogue();
create trigger video_scenes_audit after insert or update or delete on public.video_scenes
  for each row execute function public.log_catalogue_change();

-- Status rules. Functions in this file mark their own changes with a transaction-local flag; direct API updates
-- cannot. Direct updates by owners/editors may only make these moves.
create function public.guard_video_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare internal boolean := coalesce(current_setting('studio.internal', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' and not internal then
      raise exception 'A new video must start as a draft' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status and not internal then
    if not ((old.status, new.status) in (
         ('failed', 'draft'), ('archived', 'draft'), ('draft', 'archived'), ('failed', 'archived'),
         ('ready_to_post', 'published_manually'), ('ready_to_post', 'archived'),
         ('published_manually', 'archived'))) then
      raise exception 'Status change % -> % is not allowed here', old.status, new.status using errcode = '42501';
    end if;
  end if;
  -- Content is frozen while a video is waiting or rendering.
  if not internal and old.status in ('queued', 'rendering') then
    raise exception 'A queued or rendering video cannot be edited' using errcode = '42501';
  end if;
  if new.status = 'published_manually' and old.status <> 'published_manually' then
    new.published_at := now();
  end if;
  return new;
end;
$$;
create trigger video_projects_guard before insert or update on public.video_projects
  for each row execute function public.guard_video_status();

create function public.log_video_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.video_status_history (project_id, from_status, to_status, changed_by, note)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid(), new.status_note);
  end if;
  return null;
end;
$$;
create trigger video_projects_history after insert or update on public.video_projects
  for each row execute function public.log_video_status();

-- A Supplier Spotlight needs a recorded, not-withdrawn consent when it is created or its supplier changes.
create function public.guard_video_consent()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.video_type = 'supplier_spotlight'
     and (tg_op = 'INSERT' or new.supplier_id is distinct from old.supplier_id or old.video_type <> 'supplier_spotlight')
     and not exists (select 1 from public.supplier_consents c
                     where c.supplier_id = new.supplier_id and not c.withdrawn) then
    raise exception 'Supplier Spotlight needs a recorded supplier consent first' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger video_projects_consent before insert or update on public.video_projects
  for each row execute function public.guard_video_consent();

-- Scenes can only change while the video is a draft or has failed.
create function public.guard_scene_editable()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare s text; pid uuid := coalesce(new.project_id, old.project_id);
begin
  select status into s from public.video_projects where id = pid;
  if s is not null and s not in ('draft', 'failed') then
    raise exception 'Scenes can only be edited while the video is a draft or failed' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger video_scenes_editable before insert or update or delete on public.video_scenes
  for each row execute function public.guard_scene_editable();

revoke all on function public.guard_video_status(), public.log_video_status(),
  public.guard_video_consent(), public.guard_scene_editable() from public, anon, authenticated;

-- 5. Queue, cancel (owners/editors) ----------------------------------------------------------------------------
create function public.queue_video(p_project uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v public.video_projects%rowtype;
  pr public.products%rowtype;
  n int; total int; job uuid; plan jsonb;
begin
  if not public.is_editor_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v from public.video_projects where id = p_project for update;
  if not found then raise exception 'Video not found'; end if;
  if v.status not in ('draft', 'failed') then raise exception 'Only a draft or failed video can be queued'; end if;

  if v.product_id is not null then
    select * into pr from public.products where id = v.product_id;
    if not (pr.active and pr.image_approved and pr.image_path is not null) then
      raise exception 'The product must be active with an approved image';
    end if;
  end if;
  if v.video_type = 'wholesale_offer' and pr.min_order_quantity is null then
    raise exception 'A wholesale offer needs the product''s minimum order quantity';
  end if;
  if v.video_type = 'supplier_spotlight' and not exists (
       select 1 from public.supplier_consents c where c.supplier_id = v.supplier_id and not c.withdrawn) then
    raise exception 'Supplier Spotlight needs a recorded supplier consent';
  end if;

  select count(*), coalesce(sum(duration_ms), 0) into n, total from public.video_scenes where project_id = p_project;
  if n < 3 then raise exception 'Add at least 3 scenes first'; end if;
  if abs(total - v.duration_seconds * 1000) > 500 then
    raise exception 'Scene times add up to % ms but the video length is % s', total, v.duration_seconds;
  end if;
  if exists (select 1 from public.video_scenes s where s.project_id = p_project and s.image_path is not null
             and (storage.foldername(s.image_path))[1] not in ('products', 'categories', 'suppliers', 'campaigns')) then
    raise exception 'Scene images must come from the catalogue folders';
  end if;

  select jsonb_build_object(
           'project', jsonb_build_object('id', v.id, 'title', v.title, 'video_type', v.video_type, 'language', v.language,
                       'duration_seconds', v.duration_seconds, 'style', v.style, 'cta_type', v.cta_type, 'cta_value', v.cta_value),
           'scenes', coalesce((select jsonb_agg(to_jsonb(s) - 'created_at' - 'created_by' - 'updated_at' - 'updated_by' order by s.position)
                               from public.video_scenes s where s.project_id = p_project), '[]'::jsonb))
    into plan;

  perform set_config('studio.internal', 'on', true);
  insert into public.render_jobs (project_id, expected_ms, plan, requested_by)
  values (p_project, v.duration_seconds * 1000, plan, auth.uid()) returning id into job;
  update public.video_projects set status = 'queued', status_note = null where id = p_project;
  perform set_config('studio.internal', 'off', true);
  return job;
end;
$$;

create function public.cancel_video(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_editor_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform 1 from public.video_projects where id = p_project and status = 'queued' for update;
  if not found then raise exception 'Only a queued video can be cancelled'; end if;
  perform set_config('studio.internal', 'on', true);
  update public.render_jobs set status = 'cancelled', finished_at = now() where project_id = p_project and status = 'queued';
  update public.video_projects set status = 'draft', status_note = 'Cancelled before rendering' where id = p_project;
  perform set_config('studio.internal', 'off', true);
end;
$$;

-- 6. Renderer functions (the only way to reach Rendering / Ready to post) ---------------------------------------
-- Claim the oldest queued job (or one stuck in rendering for 30+ minutes). One attempt is counted per claim.
create function public.renderer_claim_job()
returns setof public.render_jobs
language plpgsql security definer set search_path = ''
as $$
declare j public.render_jobs%rowtype;
begin
  if not public.is_renderer() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into j from public.render_jobs
   where status = 'queued' or (status = 'rendering' and claimed_at < now() - interval '30 minutes')
   order by created_at limit 1 for update skip locked;
  if not found then return; end if;
  if j.attempt >= j.max_attempts then
    perform set_config('studio.internal', 'on', true);
    update public.render_jobs set status = 'failed', finished_at = now(), error_message = 'Gave up after repeated attempts' where id = j.id;
    update public.video_projects set status = 'failed', status_note = 'Gave up after repeated attempts' where id = j.project_id;
    perform set_config('studio.internal', 'off', true);
    return;
  end if;
  perform set_config('studio.internal', 'on', true);
  update public.render_jobs set status = 'rendering', attempt = attempt + 1, claimed_at = now()
   where id = j.id returning * into j;
  update public.video_projects set status = 'rendering', status_note = null where id = j.project_id;
  perform set_config('studio.internal', 'off', true);
  return next j;
end;
$$;

create function public.renderer_fail_job(p_job uuid, p_message text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare j public.render_jobs%rowtype; msg text := left(coalesce(nullif(btrim(p_message), ''), 'Unknown error'), 500);
begin
  if not public.is_renderer() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into j from public.render_jobs where id = p_job and status = 'rendering' for update;
  if not found then raise exception 'Job is not rendering'; end if;
  perform set_config('studio.internal', 'on', true);
  if j.attempt < j.max_attempts then
    update public.render_jobs set status = 'queued', error_message = msg where id = j.id;
    update public.video_projects set status = 'queued', status_note = 'Retrying: ' || msg where id = j.project_id;
    perform set_config('studio.internal', 'off', true);
    return 'retry';
  end if;
  update public.render_jobs set status = 'failed', error_message = msg, finished_at = now() where id = j.id;
  update public.video_projects set status = 'failed', status_note = msg where id = j.project_id;
  perform set_config('studio.internal', 'off', true);
  return 'failed';
end;
$$;

-- p_probe is the renderer's ffprobe summary:
-- {"width":1080,"height":1920,"codec":"h264","pix_fmt":"yuv420p","fps":30,"duration_s":20.0,"has_audio":false,"audio_codec":null}
create function public.renderer_complete_job(p_job uuid, p_output text, p_cover text, p_probe jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  j public.render_jobs%rowtype; problems text[] := '{}';
  dur numeric; fps numeric;
begin
  if not public.is_renderer() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into j from public.render_jobs where id = p_job and status = 'rendering' for update;
  if not found then raise exception 'Job is not rendering'; end if;

  begin
    dur := (p_probe ->> 'duration_s')::numeric;
    fps := (p_probe ->> 'fps')::numeric;
  exception when others then
    return public.renderer_fail_job(p_job, 'Verification failed: unreadable ffprobe report');
  end;
  if (p_probe ->> 'width') is distinct from '1080' or (p_probe ->> 'height') is distinct from '1920' then
    problems := array_append(problems, 'size must be 1080x1920'::text); end if;
  if (p_probe ->> 'codec') is distinct from 'h264' then problems := array_append(problems, 'codec must be h264'::text); end if;
  if (p_probe ->> 'pix_fmt') is distinct from 'yuv420p' then problems := array_append(problems, 'pixel format must be yuv420p'::text); end if;
  if fps is null or fps < 29.97 or fps > 30.03 then problems := array_append(problems, 'frame rate must be 30'::text); end if;
  if dur is null or abs(dur * 1000 - j.expected_ms) > 600 then problems := array_append(problems, 'duration is wrong'::text); end if;
  if coalesce((p_probe ->> 'has_audio')::boolean, false) and (p_probe ->> 'audio_codec') is distinct from 'aac' then
    problems := array_append(problems, 'audio must be aac'::text); end if;
  if p_output is null or p_output not like j.project_id::text || '/%' or p_output !~ '\.mp4$' then
    problems := array_append(problems, 'output path must be <project>/<file>.mp4'::text); end if;
  if p_cover is null or p_cover not like j.project_id::text || '/%' then
    problems := array_append(problems, 'cover path must be inside the project folder'::text); end if;

  if cardinality(problems) > 0 then
    return public.renderer_fail_job(p_job, 'Verification failed: ' || array_to_string(problems, '; '));
  end if;

  perform set_config('studio.internal', 'on', true);
  update public.render_jobs set status = 'succeeded', output_path = p_output, cover_path = p_cover,
         probe = p_probe, error_message = null, finished_at = now() where id = j.id;
  update public.video_projects set status = 'ready_to_post', status_note = null where id = j.project_id;
  perform set_config('studio.internal', 'off', true);
  return 'ready';
end;
$$;

revoke all on function public.queue_video(uuid), public.cancel_video(uuid), public.renderer_claim_job(),
  public.renderer_fail_job(uuid, text), public.renderer_complete_job(uuid, text, text, jsonb) from public, anon;
grant execute on function public.queue_video(uuid), public.cancel_video(uuid) to authenticated;
grant execute on function public.renderer_claim_job(), public.renderer_fail_job(uuid, text),
  public.renderer_complete_job(uuid, text, text, jsonb) to authenticated;
-- The renderer functions check is_renderer() themselves, so any other signed-in user is refused.

-- 7. Row Level Security and grants -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['supplier_consents', 'video_projects', 'video_scenes', 'render_jobs', 'video_status_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create policy supplier_consents_select on public.supplier_consents for select to authenticated using (public.is_member());
create policy video_projects_select on public.video_projects for select to authenticated
  using (public.is_member() or public.is_renderer());
create policy video_scenes_select on public.video_scenes for select to authenticated
  using (public.is_member() or public.is_renderer());
create policy render_jobs_select on public.render_jobs for select to authenticated
  using (public.is_member() or public.is_renderer());
create policy video_status_history_select on public.video_status_history for select to authenticated
  using (public.is_member());

-- Owners/editors write consents, projects and scenes. Jobs and history are written only by functions/triggers.
grant insert (supplier_id, note, given_on, withdrawn), update (note, given_on, withdrawn), delete
  on public.supplier_consents to authenticated;
create policy supplier_consents_insert on public.supplier_consents for insert to authenticated with check (public.is_editor_or_owner());
create policy supplier_consents_update on public.supplier_consents for update to authenticated
  using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());
create policy supplier_consents_delete on public.supplier_consents for delete to authenticated using (public.is_owner());

grant insert (title, video_type, product_id, supplier_id, campaign_id, language, duration_seconds, style, cta_type,
              cta_value, caption, hashtags, suggested_post_time),
      update (title, video_type, product_id, supplier_id, campaign_id, language, duration_seconds, style, cta_type,
              cta_value, caption, hashtags, suggested_post_time, status, status_note),
      delete on public.video_projects to authenticated;
create policy video_projects_insert on public.video_projects for insert to authenticated with check (public.is_editor_or_owner());
create policy video_projects_update on public.video_projects for update to authenticated
  using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());
create policy video_projects_delete on public.video_projects for delete to authenticated
  using (public.is_editor_or_owner() and status in ('draft', 'failed', 'archived'));

grant insert (project_id, position, scene_type, duration_ms, headline, body, image_path, animation, source),
      update (position, scene_type, duration_ms, headline, body, image_path, animation, source),
      delete on public.video_scenes to authenticated;
create policy video_scenes_insert on public.video_scenes for insert to authenticated with check (public.is_editor_or_owner());
create policy video_scenes_update on public.video_scenes for update to authenticated
  using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());
create policy video_scenes_delete on public.video_scenes for delete to authenticated using (public.is_editor_or_owner());

-- 8. Storage for the renderer -------------------------------------------------------------------------------------
-- Members already read renders/covers (0002) and source-images (0004). The renderer may read source images, and may
-- upload ONLY into renders/ and covers/ under the id of a project that is currently rendering.
create policy "renderer reads source images"
  on storage.objects for select to authenticated
  using (bucket_id = 'source-images' and public.is_renderer());

create policy "renderer reads renders and covers"
  on storage.objects for select to authenticated
  using (bucket_id in ('renders', 'covers') and public.is_renderer());

create policy "renderer uploads renders and covers"
  on storage.objects for insert to authenticated
  with check (bucket_id in ('renders', 'covers')
              and public.is_renderer()
              and exists (select 1 from public.video_projects p
                          where p.id::text = (storage.foldername(name))[1] and p.status = 'rendering'));
