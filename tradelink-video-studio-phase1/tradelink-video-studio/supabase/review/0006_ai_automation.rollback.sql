-- ROLLBACK for 0006_ai_automation. Only run it if you want to remove Phase 4's database changes.
-- It restores queue_video() to the 0005 version, removes copy jobs, and removes Somali/template/report columns.
-- Refuses to run if any video is saved as Somali (change those videos first), so no data is silently altered.
begin;

do $$ begin
  if exists (select 1 from public.video_projects where language = 'so') then
    raise exception 'Some videos use Somali. Change or delete them before rolling back 0006.';
  end if;
end $$;

drop function if exists public.copy_complete_job(uuid, jsonb, text, text);
drop function if exists public.copy_fail_job(uuid, text);
drop function if exists public.copy_claim_job();
drop function if exists public.cancel_copy_job(uuid);
drop function if exists public.request_copy_job(uuid, text, int);
drop function if exists public.claims_problem(text, text);
drop table if exists public.copy_jobs;
drop function if exists public.save_quality_report(uuid, jsonb);

-- queue_video as in 0005 (no quality gate, no template_id in the plan)
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

alter table public.video_projects
  drop column if exists template_id, drop column if exists copy_source,
  drop column if exists quality_report, drop column if exists quality_checked_at;
alter table public.video_projects drop constraint if exists video_projects_language_check;
alter table public.video_projects add constraint video_projects_language_check check (language in ('en', 'am'));

commit;
