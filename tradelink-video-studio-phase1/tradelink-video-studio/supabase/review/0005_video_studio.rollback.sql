-- ROLLBACK for 0005. Run in the Studio SQL editor only. Deletes all video projects, scenes, jobs and history.
-- Uploaded MP4 and cover files in Storage are NOT removed by SQL; delete them in the Storage page if you want them gone.
drop policy if exists "renderer reads source images" on storage.objects;
drop policy if exists "renderer reads renders and covers" on storage.objects;
drop policy if exists "renderer uploads renders and covers" on storage.objects;

drop function if exists public.queue_video(uuid);
drop function if exists public.cancel_video(uuid);
drop function if exists public.renderer_claim_job();
drop function if exists public.renderer_fail_job(uuid, text);
drop function if exists public.renderer_complete_job(uuid, text, text, jsonb);

drop table if exists public.video_status_history;
drop table if exists public.render_jobs;
drop table if exists public.video_scenes;
drop table if exists public.video_projects;
drop table if exists public.supplier_consents;
drop table if exists public.renderer_accounts;

drop function if exists public.guard_video_status();
drop function if exists public.log_video_status();
drop function if exists public.guard_video_consent();
drop function if exists public.guard_scene_editable();
drop function if exists public.is_renderer();
