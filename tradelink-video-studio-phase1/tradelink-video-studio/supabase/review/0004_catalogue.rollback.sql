-- ROLLBACK for 0004. Deletes the catalogue tables (and everything typed into them). Uploaded image
-- files are NOT deleted by SQL; remove them in Storage if needed. The dropped sync tables are not recreated.
drop policy if exists "editors delete catalogue images" on storage.objects;
drop policy if exists "editors upload catalogue images" on storage.objects;
drop policy if exists "members read source images" on storage.objects;
drop table if exists public.campaign_products;
drop table if exists public.campaigns;
drop table if exists public.products;
drop table if exists public.suppliers;
drop table if exists public.categories;
drop function if exists public.log_catalogue_change();
drop function if exists public.stamp_catalogue();
