-- 0006_ai_automation: Somali, video templates, quality gate, copy jobs for the optional local AI (Phase 4, Stage 1).
-- FOR OWNER REVIEW. Not applied automatically. Target: the Studio Supabase project ONLY.
-- Requires 0001, 0002, 0004 and 0005 (already applied). No marketplace data, no sample rows, no keys, no paid service.
--
-- What this adds
--   1. Somali ('so') as a video language. Somali and Amharic stay DRAFT until a native speaker approves them (app rule).
--   2. video_projects.template_id / copy_source (labels) and a quality report written only by save_quality_report().
--   3. queue_video() now also refuses a video whose saved quality report says "fail". Everything it checked before
--      is unchanged; the frozen render plan now also carries template_id.
--   4. copy_jobs: a queue for the OPTIONAL local AI (Ollama on the owner's PC). Editors ask for suggested wording;
--      only the registered renderer login can claim and complete jobs. The facts sent to the AI are built inside the
--      database from approved catalogue rows. The result passes a claims guard (no invented numbers, percentages,
--      links, handles or marketing claims) before it is stored. Suggestions are NOT written into the video:
--      a person reviews and applies them in the app.
--   The status machine, renderer functions and storage policies from 0005 are not changed.

-- 1. Somali ----------------------------------------------------------------------------------------------------
alter table public.video_projects drop constraint if exists video_projects_language_check;
alter table public.video_projects add constraint video_projects_language_check check (language in ('en', 'am', 'so'));

-- 2. Template, copy source, quality report -----------------------------------------------------------------------
alter table public.video_projects
  add column template_id text
    check (template_id is null or template_id in
      ('clean_product', 'bold_sale', 'wholesale_offer', 'supplier_spotlight', 'campaign_banner', 'story_quick')),
  add column copy_source text not null default 'manual' check (copy_source in ('manual', 'rules', 'local_ai')),
  add column quality_report jsonb,
  add column quality_checked_at timestamptz;

grant insert (template_id, copy_source), update (template_id, copy_source) on public.video_projects to authenticated;
-- quality_report / quality_checked_at have NO column grant: only save_quality_report() can write them.

create function public.save_quality_report(p_project uuid, p_report jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare st text;
begin
  if not public.is_editor_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_report) is distinct from 'object' then raise exception 'Report must be an object'; end if;
  st := p_report ->> 'status';
  if st is null or st not in ('pass', 'warn', 'fail') then raise exception 'Report status must be pass, warn or fail'; end if;
  if jsonb_typeof(p_report -> 'checks') is distinct from 'array' or jsonb_array_length(p_report -> 'checks') > 60 then
    raise exception 'Report needs a checks list of at most 60 entries';
  end if;
  if length(p_report::text) > 20000 then raise exception 'Report is too large'; end if;
  perform 1 from public.video_projects where id = p_project and status in ('draft', 'failed') for update;
  if not found then raise exception 'Quality reports can only be saved for a draft or failed video'; end if;
  update public.video_projects set quality_report = jsonb_build_object('status', st, 'checks', p_report -> 'checks'),
         quality_checked_at = now() where id = p_project;
end;
$$;

-- 3. queue_video: same rules as 0005 plus the quality gate and template_id in the frozen plan -------------------
create or replace function public.queue_video(p_project uuid)
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

  if (v.quality_report ->> 'status') = 'fail' then
    raise exception 'The quality check found problems. Fix them and run the check again';
  end if;

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
                       'duration_seconds', v.duration_seconds, 'style', v.style, 'template_id', v.template_id,
                       'cta_type', v.cta_type, 'cta_value', v.cta_value),
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

-- 4. Copy jobs (optional local AI) ---------------------------------------------------------------------------------
create table public.copy_jobs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.video_projects (id) on delete cascade,
  scope         text not null default 'all' check (scope in ('all', 'caption', 'scene')),
  scene_position integer check (scene_position between 1 and 30),
  language      text not null check (language in ('en', 'am', 'so')),
  status        text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt       integer not null default 0 check (attempt >= 0),
  max_attempts  integer not null default 2 check (max_attempts between 1 and 3),
  facts         jsonb not null,                       -- approved catalogue facts, built by the database
  result        jsonb,                                -- guarded suggestions (never applied automatically)
  provider      text check (char_length(provider) <= 40),
  model         text check (char_length(model) <= 80),
  error_message text check (char_length(error_message) <= 500),
  requested_by  uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  finished_at   timestamptz,
  constraint copy_scene_scope check ((scope = 'scene') = (scene_position is not null))
);
create index copy_jobs_status_idx on public.copy_jobs (status, created_at);
create index copy_jobs_project_idx on public.copy_jobs (project_id, created_at);
create unique index copy_jobs_one_open_per_project on public.copy_jobs (project_id) where status in ('queued', 'running');

alter table public.copy_jobs enable row level security;
revoke all on public.copy_jobs from anon, authenticated;
grant select on public.copy_jobs to authenticated;
create policy copy_jobs_select on public.copy_jobs for select to authenticated using (public.is_member());

-- Claims guard (database side). Returns a plain reason, or null when the text is acceptable.
-- A banned word is fine only when the approved facts themselves contain it. The Somali and Amharic word lists are
-- DRAFT and unverified by a native speaker; the app runs the same guard first, so this is the second lock.
create function public.claims_problem(p_text text, p_facts text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  t text := coalesce(p_text, '');
  f text := lower(replace(coalesce(p_facts, ''), ',', ''));
  tok text; w text;
  banned text[] := array[
    'best', 'cheapest', 'lowest price', 'number one', 'no. 1', 'guarantee', 'guaranteed', 'certified', 'organic', 'halal',
    'fda', 'iso', 'free', 'discount', 'limited time', 'only today', 'hurry', 'authentic', 'original', 'award', 'top rated',
    'ugu fiican', 'ugu fiican', 'ugu jaban', 'dammaanad', 'bilaash', 'dhaqso',
    'ምርጥ', 'ርካሽ', 'ዋስትና', 'ነፃ', 'ነጻ'];
begin
  if t ~ '[\x00-\x08\x0b-\x1f\x7f]' then return 'contains control characters'; end if;
  if t ~ '[<>]' then return 'contains markup characters'; end if;
  if t ~ '%' then return 'contains a percentage, which is not in the approved data'; end if;
  if t ~ '[፩-፼]' then return 'contains Ethiopic numerals, which cannot be checked against the data'; end if;
  if t ~* '(https?://|www\.|@[a-z0-9_]+|[a-z0-9-]+\.(com|net|org|et|app|io)\y)' then return 'contains a link, e-mail or handle'; end if;
  for tok in select (r.m)[1] from regexp_matches(t, '([0-9]+(?:[.,][0-9]+)*)', 'g') as r(m) loop
    if position(replace(tok, ',', '') in f) = 0 then return 'number ' || tok || ' is not in the approved data'; end if;
  end loop;
  foreach w in array banned loop
    if lower(t) ~ ('(^|[^[:alnum:]])' || w || '([^[:alnum:]]|$)') and position(w in f) = 0 then
      return 'claim "' || w || '" is not in the approved data';
    end if;
  end loop;
  return null;
end;
$$;

-- Ask for suggested wording. The facts come from the catalogue, not from the caller.
create function public.request_copy_job(p_project uuid, p_scope text default 'all', p_scene int default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v public.video_projects%rowtype;
  pr public.products%rowtype; su public.suppliers%rowtype; ca public.campaigns%rowtype;
  f jsonb; job uuid;
begin
  if not public.is_editor_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_scope not in ('all', 'caption', 'scene') then raise exception 'Unknown scope'; end if;
  select * into v from public.video_projects where id = p_project for update;
  if not found then raise exception 'Video not found'; end if;
  if v.status not in ('draft', 'failed') then raise exception 'Suggestions can only be requested for a draft or failed video'; end if;
  if (select count(*) from public.copy_jobs where requested_by = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many suggestion requests this hour. Try again later';
  end if;

  f := jsonb_build_object('video_type', v.video_type, 'language', v.language, 'cta_type', v.cta_type, 'cta_value', v.cta_value);
  if v.product_id is not null then
    select * into pr from public.products where id = v.product_id;
    f := f || jsonb_build_object('product', jsonb_strip_nulls(jsonb_build_object(
      'name', pr.name, 'brand', pr.brand, 'description', pr.description, 'unit', pr.unit, 'package_size', pr.package_size,
      'min_order_quantity', pr.min_order_quantity, 'retail_price', pr.retail_price, 'sale_price', pr.sale_price,
      'stock_status', pr.stock_status)));
  elsif v.supplier_id is not null then
    select * into su from public.suppliers where id = v.supplier_id;
    f := f || jsonb_build_object('supplier', jsonb_strip_nulls(jsonb_build_object(
      'name', su.name, 'industry', su.industry, 'location', su.location, 'description', su.description)));
  elsif v.campaign_id is not null then
    select * into ca from public.campaigns where id = v.campaign_id;
    f := f || jsonb_build_object('campaign', jsonb_strip_nulls(jsonb_build_object('name', ca.name, 'description', ca.description)));
  end if;

  insert into public.copy_jobs (project_id, scope, scene_position, language, facts, requested_by)
  values (p_project, p_scope, case when p_scope = 'scene' then p_scene end, v.language, f, auth.uid())
  returning id into job;
  return job;
exception when unique_violation then
  raise exception 'A suggestion request for this video is already waiting';
end;
$$;

create function public.cancel_copy_job(p_job uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_editor_or_owner() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.copy_jobs set status = 'cancelled', finished_at = now() where id = p_job and status = 'queued';
  if not found then raise exception 'Only a waiting request can be cancelled'; end if;
end;
$$;

-- Renderer-side functions (the registered renderer login only)
create function public.copy_claim_job()
returns setof public.copy_jobs
language plpgsql security definer set search_path = ''
as $$
declare j public.copy_jobs%rowtype;
begin
  if not public.is_renderer() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into j from public.copy_jobs
   where status = 'queued' or (status = 'running' and claimed_at < now() - interval '10 minutes')
   order by created_at limit 1 for update skip locked;
  if not found then return; end if;
  if j.attempt >= j.max_attempts then
    update public.copy_jobs set status = 'failed', finished_at = now(), error_message = 'Gave up after repeated attempts' where id = j.id;
    return;
  end if;
  update public.copy_jobs set status = 'running', attempt = attempt + 1, claimed_at = now() where id = j.id returning * into j;
  return next j;
end;
$$;

create function public.copy_fail_job(p_job uuid, p_message text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare j public.copy_jobs%rowtype; msg text := left(coalesce(nullif(btrim(p_message), ''), 'Unknown error'), 500);
begin
  if not public.is_renderer() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into j from public.copy_jobs where id = p_job and status = 'running' for update;
  if not found then raise exception 'Job is not running'; end if;
  if j.attempt < j.max_attempts then
    update public.copy_jobs set status = 'queued', error_message = msg where id = j.id;
    return 'retry';
  end if;
  update public.copy_jobs set status = 'failed', error_message = msg, finished_at = now() where id = j.id;
  return 'failed';
end;
$$;

-- p_result: {"scenes":[{"position":1,"headline":"...","body":"..."}], "caption":"...", "hashtags":["a","b"]}
-- Every text passes claims_problem() against the job's facts (plus the CTA value). On a problem the job FAILS with the
-- reason; nothing unsafe is stored. Only a clean, re-built copy of the whitelisted fields is kept.
create function public.copy_complete_job(p_job uuid, p_result jsonb, p_provider text, p_model text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  j public.copy_jobs%rowtype; facts text; s jsonb; h text; txt text; prob text;
  out_scenes jsonb := '[]'::jsonb; out_tags jsonb := '[]'::jsonb; cap text; seen int[] := '{}'; pos int;
begin
  if not public.is_renderer() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into j from public.copy_jobs where id = p_job and status = 'running' for update;
  if not found then raise exception 'Job is not running'; end if;
  facts := j.facts::text;

  if jsonb_typeof(p_result) is distinct from 'object' then return public.copy_fail_job(p_job, 'Result is not an object'); end if;
  if jsonb_typeof(coalesce(p_result -> 'scenes', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_result -> 'scenes', '[]'::jsonb)) > 12 then
    return public.copy_fail_job(p_job, 'Result has an invalid scenes list');
  end if;

  for s in select * from jsonb_array_elements(coalesce(p_result -> 'scenes', '[]'::jsonb)) loop
    if jsonb_typeof(s) <> 'object' or jsonb_typeof(s -> 'position') <> 'number' or (s ->> 'position') !~ '^[0-9]{1,2}$' then
      return public.copy_fail_job(p_job, 'A scene suggestion has no valid position');
    end if;
    pos := (s ->> 'position')::int;
    if pos < 1 or pos > 30 or pos = any (seen) or (j.scope = 'scene' and pos <> j.scene_position) then
      return public.copy_fail_job(p_job, 'A scene suggestion has an unexpected position');
    end if;
    seen := array_append(seen, pos);
    foreach txt in array array['headline', 'body'] loop
      if s -> txt is not null and jsonb_typeof(s -> txt) not in ('string', 'null') then
        return public.copy_fail_job(p_job, 'A scene suggestion has a non-text field');
      end if;
      if jsonb_typeof(s -> txt) = 'string' then
        if char_length(s ->> txt) > (case when txt = 'headline' then 200 else 600 end) then
          return public.copy_fail_job(p_job, 'A scene suggestion is too long');
        end if;
        prob := public.claims_problem(s ->> txt, facts);
        if prob is not null then return public.copy_fail_job(p_job, 'Claims guard: ' || prob); end if;
      end if;
    end loop;
    out_scenes := out_scenes || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'position', pos, 'headline', s -> 'headline', 'body', s -> 'body')));
  end loop;

  if j.scope = 'scene' and jsonb_array_length(out_scenes) = 0 then
    return public.copy_fail_job(p_job, 'No suggestion was returned for the scene');
  end if;

  if p_result ? 'caption' and jsonb_typeof(p_result -> 'caption') = 'string' then
    cap := p_result ->> 'caption';
    if char_length(cap) > 2200 then return public.copy_fail_job(p_job, 'Caption is too long'); end if;
    prob := public.claims_problem(cap, facts);
    if prob is not null then return public.copy_fail_job(p_job, 'Claims guard: ' || prob); end if;
  end if;

  if jsonb_typeof(coalesce(p_result -> 'hashtags', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_result -> 'hashtags', '[]'::jsonb)) > 30 then
    return public.copy_fail_job(p_job, 'Result has an invalid hashtag list');
  end if;
  for h in select jsonb_array_elements_text(coalesce(p_result -> 'hashtags', '[]'::jsonb)) loop
    if h !~ '^[[:alnum:]_]{1,60}$' then return public.copy_fail_job(p_job, 'A hashtag has invalid characters'); end if;
    prob := public.claims_problem(h, facts);
    if prob is not null then return public.copy_fail_job(p_job, 'Claims guard: ' || prob); end if;
    out_tags := out_tags || to_jsonb(h);
  end loop;

  update public.copy_jobs
     set status = 'succeeded', finished_at = now(), error_message = null,
         provider = left(coalesce(p_provider, ''), 40), model = left(coalesce(p_model, ''), 80),
         result = jsonb_strip_nulls(jsonb_build_object('scenes', out_scenes, 'caption', cap, 'hashtags', out_tags))
   where id = p_job;
  return 'ok';
end;
$$;

revoke all on function public.save_quality_report(uuid, jsonb), public.claims_problem(text, text),
  public.request_copy_job(uuid, text, int), public.cancel_copy_job(uuid), public.copy_claim_job(),
  public.copy_fail_job(uuid, text), public.copy_complete_job(uuid, jsonb, text, text), public.queue_video(uuid)
  from public, anon;
grant execute on function public.queue_video(uuid), public.save_quality_report(uuid, jsonb),
  public.request_copy_job(uuid, text, int), public.cancel_copy_job(uuid),
  public.copy_claim_job(), public.copy_fail_job(uuid, text), public.copy_complete_job(uuid, jsonb, text, text) to authenticated;
-- claims_problem() is internal: it is called only by the functions above (no grant to API roles).
-- The renderer-side functions check is_renderer() themselves, so any other signed-in user is refused.
