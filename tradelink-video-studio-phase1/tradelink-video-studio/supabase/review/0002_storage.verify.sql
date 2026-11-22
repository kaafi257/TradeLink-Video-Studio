-- SELECT-only checks after applying 0002.
-- 1. Four private buckets (expect public = false for all).
select id, public, file_size_limit, allowed_mime_types from storage.buckets
where id in ('source-images', 'renders', 'covers', 'music') order by id;

-- 2. Policies on storage.objects created by this migration (expect three).
select policyname, cmd, roles from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname in ('studio members read renders and covers',
                     'editors read source images and music',
                     'owner deletes studio files');
