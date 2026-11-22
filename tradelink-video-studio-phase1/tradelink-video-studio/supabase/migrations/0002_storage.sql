-- 0002_storage: private buckets for the Studio. FOR OWNER REVIEW. Not applied automatically.
-- Requires 0001 (uses public.is_member / is_editor_or_owner / is_owner).
-- The file size limits below are PROPOSALS for you to review, not final values.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('source-images', 'source-images', false, 10485760,  array['image/jpeg', 'image/png', 'image/webp']),
  ('renders',       'renders',       false, 104857600, array['video/mp4']),
  ('covers',        'covers',        false, 10485760,  array['image/jpeg', 'image/png', 'image/webp']),
  ('music',         'music',         false, 20971520,  array['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav'])
on conflict (id) do nothing;

-- Read access only. There is deliberately NO insert or update policy: uploads are made by the
-- server (service role) until a later phase adds narrower policies. No anonymous access.
create policy "studio members read renders and covers"
  on storage.objects for select to authenticated
  using (bucket_id in ('renders', 'covers') and public.is_member());

create policy "editors read source images and music"
  on storage.objects for select to authenticated
  using (bucket_id in ('source-images', 'music') and public.is_editor_or_owner());

create policy "owner deletes studio files"
  on storage.objects for delete to authenticated
  using (bucket_id in ('source-images', 'renders', 'covers', 'music') and public.is_owner());
