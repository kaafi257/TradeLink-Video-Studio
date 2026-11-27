-- Rollback for 0009. Fails if a video already uses one of the three new templates (move or archive it first).
alter table public.video_projects drop constraint if exists video_projects_template_id_check;
alter table public.video_projects add constraint video_projects_template_id_check check (template_id is null or template_id in
  ('clean_product', 'bold_sale', 'wholesale_offer', 'supplier_spotlight', 'campaign_banner', 'story_quick'));
