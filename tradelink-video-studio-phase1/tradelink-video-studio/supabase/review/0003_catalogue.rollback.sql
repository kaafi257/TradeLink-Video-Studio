-- ROLLBACK for 0003. Removes the catalogue copy and the sync log (both can be rebuilt by syncing again).
drop function if exists public.catalogue_fail_run(uuid, text);
drop function if exists public.catalogue_replace(uuid, jsonb);
drop function if exists public.catalogue_start_run(text);
drop table if exists public.catalogue_items;
drop table if exists public.sync_runs;
