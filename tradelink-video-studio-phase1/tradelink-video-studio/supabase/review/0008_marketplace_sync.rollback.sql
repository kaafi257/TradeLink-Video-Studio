-- Rollback for 0008. Removes the sync functions and tables. Copied catalogue rows and pictures are NOT removed.
begin;
drop function if exists public.marketplace_apply(uuid, jsonb);
drop function if exists public.marketplace_finish_run(uuid, text, jsonb, text);
drop function if exists public.marketplace_start_run();
drop function if exists public.marketplace_url(text);
drop function if exists public.marketplace_txt(text, int);
drop function if exists public.marketplace_int(text);
drop function if exists public.marketplace_num(text);
drop table if exists public.sync_runs;
drop table if exists public.marketplace_links;
commit;
