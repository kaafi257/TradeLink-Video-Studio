-- 0007_copy_scene_context: lets a suggestion request carry the saved scene wording (Phase 4, Stage 5).
-- FOR OWNER REVIEW. Not applied automatically. Requires 0006. Studio Supabase project ONLY. No data is changed.
--   - request_copy_job(): for scope 'all' the facts now include the saved scenes (position, type, headline, body);
--     for scope 'scene' they include that scene. The claims guard still lets a model use only numbers and words that
--     appear in the facts, so scene text built from the catalogue stays allowed and nothing else is.
--   - Same permissions as 0006. Re-running this file is safe (create or replace).

-- Ask for suggested wording. The facts come from the catalogue, not from the caller.
create or replace function public.request_copy_job(p_project uuid, p_scope text default 'all', p_scene int default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v public.video_projects%rowtype;
  pr public.products%rowtype; su public.suppliers%rowtype; ca public.campaigns%rowtype;
  f jsonb; job uuid; sc public.video_scenes%rowtype;
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

  -- Scene wording the model may rewrite. It comes from the saved scenes (themselves built from approved data).
  if p_scope = 'scene' then
    select * into sc from public.video_scenes where project_id = p_project and position = p_scene;
    if not found then raise exception 'Scene not found'; end if;
    f := f || jsonb_build_object('scene', jsonb_strip_nulls(jsonb_build_object(
      'position', sc.position, 'scene_type', sc.scene_type, 'headline', sc.headline, 'body', sc.body)));
  elsif p_scope = 'all' then
    f := f || jsonb_build_object('scenes', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'position', x.position, 'scene_type', x.scene_type, 'headline', x.headline, 'body', x.body)) order by x.position)
      from public.video_scenes x where x.project_id = p_project), '[]'::jsonb));
  end if;

  insert into public.copy_jobs (project_id, scope, scene_position, language, facts, requested_by)
  values (p_project, p_scope, case when p_scope = 'scene' then p_scene end, v.language, f, auth.uid())
  returning id into job;
  return job;
exception when unique_violation then
  raise exception 'A suggestion request for this video is already waiting';
end;
$$;

revoke all on function public.request_copy_job(uuid, text, int) from public, anon;
grant execute on function public.request_copy_job(uuid, text, int) to authenticated;
