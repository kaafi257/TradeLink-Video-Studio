-- ROLLBACK for 0002. Buckets can only be removed while empty.
drop policy if exists "studio members read renders and covers" on storage.objects;
drop policy if exists "editors read source images and music" on storage.objects;
drop policy if exists "owner deletes studio files" on storage.objects;
delete from storage.buckets where id in ('source-images', 'renders', 'covers', 'music');
