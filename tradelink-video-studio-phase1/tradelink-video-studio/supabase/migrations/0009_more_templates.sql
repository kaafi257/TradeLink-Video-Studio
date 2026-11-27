-- 0009_more_templates: three more video templates (Phase 5, Stage A). FOR OWNER REVIEW. NOT applied automatically.
-- Target: the Studio Supabase project ONLY. Requires 0006.
-- Only widens the list of allowed template ids. Existing videos are untouched. Nothing else changes.
alter table public.video_projects drop constraint if exists video_projects_template_id_check;
alter table public.video_projects add constraint video_projects_template_id_check check (template_id is null or template_id in
  ('clean_product', 'bold_sale', 'wholesale_offer', 'supplier_spotlight', 'campaign_banner', 'story_quick',
   'minimal_product', 'wholesale_bold', 'campaign_minimal'));
