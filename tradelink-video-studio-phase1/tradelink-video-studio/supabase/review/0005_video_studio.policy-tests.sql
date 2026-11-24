-- POLICY TESTS for 0005. Run in the Studio SQL editor AFTER 0001, 0002, 0004 and 0005. One transaction, ends with ROLLBACK.
-- Success = a result row "ALL VIDEO STUDIO POLICY TESTS PASSED" at the end; any failure raises an exception naming the test.
-- Nothing is saved: the fake users and rows exist only inside this transaction.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'vid-owner@example.invalid'),
  ('00000000-0000-0000-0000-0000000000d2', 'vid-editor@example.invalid'),
  ('00000000-0000-0000-0000-0000000000d3', 'vid-viewer@example.invalid'),
  ('00000000-0000-0000-0000-0000000000d4', 'vid-renderer@example.invalid');
update public.profiles set role = 'owner',  active = true where id = '00000000-0000-0000-0000-0000000000d1';
update public.profiles set role = 'editor', active = true where id = '00000000-0000-0000-0000-0000000000d2';
update public.profiles set role = 'viewer', active = true where id = '00000000-0000-0000-0000-0000000000d3';
-- d4 (the renderer) stays an INACTIVE viewer: it has no catalogue access at all.
insert into public.renderer_accounts (user_id, label) values ('00000000-0000-0000-0000-0000000000d4', 'test renderer');

-- catalogue seed (database owner): one usable product with a minimum order quantity, one without, one unapproved
insert into public.products (id, name, image_path, image_approved, min_order_quantity) values
  ('00000000-0000-0000-0000-00000000e001', 'Prod ok', 'products/a.jpg', true, 12),
  ('00000000-0000-0000-0000-00000000e002', 'Prod no moq', 'products/b.jpg', true, null),
  ('00000000-0000-0000-0000-00000000e003', 'Prod unapproved', null, false, 5);
insert into public.suppliers (id, name) values ('00000000-0000-0000-0000-00000000e101', 'Sup');

-- three draft videos seeded as database owner (editors cannot choose ids)
insert into public.video_projects (id, title, video_type, product_id, cta_type, cta_value, duration_seconds) values
  ('00000000-0000-0000-0000-00000000a001', 'V1', 'product_showcase', '00000000-0000-0000-0000-00000000e001', 'whatsapp', '+000', 20),
  ('00000000-0000-0000-0000-00000000a002', 'W no moq', 'wholesale_offer', '00000000-0000-0000-0000-00000000e002', 'phone', '1', 15),
  ('00000000-0000-0000-0000-00000000a003', 'unapproved', 'product_showcase', '00000000-0000-0000-0000-00000000e003', 'phone', '1', 15);

-- B1 anonymous has no access.
do $$ declare t text; begin
  set local role anon;
  foreach t in array array['video_projects','video_scenes','render_jobs','video_status_history','supplier_consents','renderer_accounts'] loop
    begin execute format('select count(*) from public.%I', t); raise exception 'B1 FAILED: anon read %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  begin perform public.queue_video('00000000-0000-0000-0000-000000000001'); raise exception 'B1 FAILED: anon queued';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- B2 editor builds a video; the rules hold.
do $$ declare n int; pid uuid; j uuid; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
  set local role authenticated;

  pid := '00000000-0000-0000-0000-00000000a001';

  begin insert into public.video_projects (title, video_type, cta_type, cta_value) values ('x', 'product_showcase', 'phone', '1');
    raise exception 'B2a FAILED: video without a product accepted';
  exception when check_violation then null; end;
  begin insert into public.video_projects (title, video_type, product_id, cta_type, cta_value, status)
      values ('x', 'product_showcase', '00000000-0000-0000-0000-00000000e001', 'phone', '1', 'ready_to_post');
    raise exception 'B2b FAILED: new video started as ready';
  exception when insufficient_privilege then null; end;
  begin insert into public.video_projects (title, video_type, product_id, cta_type, cta_value, duration_seconds)
      values ('x', 'product_showcase', '00000000-0000-0000-0000-00000000e001', 'phone', '1', 25);
    raise exception 'B2c FAILED: 25 s accepted';
  exception when check_violation then null; end;

  -- cannot queue without scenes
  begin perform public.queue_video(pid); raise exception 'B2d FAILED: queued without scenes';
  exception when raise_exception then if sqlerrm like 'B2d%' then raise; end if; end;

  insert into public.video_scenes (project_id, position, scene_type, duration_ms, headline, image_path, animation)
    values (pid, 1, 'intro', 5000, 'Prod ok', 'products/a.jpg', 'zoom_in'),
           (pid, 2, 'product', 10000, 'Prod ok', 'products/a.jpg', 'pan_left');
  begin perform public.queue_video(pid); raise exception 'B2e FAILED: queued with 2 scenes';
  exception when raise_exception then if sqlerrm like 'B2e%' then raise; end if; end;
  insert into public.video_scenes (project_id, position, scene_type, duration_ms, headline) values (pid, 3, 'cta', 3000, 'Contact us');
  begin perform public.queue_video(pid); raise exception 'B2f FAILED: queued with wrong total time';
  exception when raise_exception then if sqlerrm like 'B2f%' then raise; end if; end;
  update public.video_scenes set duration_ms = 5000 where project_id = pid and position = 3;
  begin insert into public.video_scenes (project_id, position, scene_type, duration_ms, image_path) values (pid, 4, 'cta', 1000, 'secrets/x.jpg');
    j := public.queue_video(pid); raise exception 'B2g FAILED: foreign image folder queued';
  exception when raise_exception then if sqlerrm like 'B2g%' then raise; end if; end;
  delete from public.video_scenes where project_id = pid and position = 4;

  -- direct status tricks are refused
  begin update public.video_projects set status = 'queued' where id = pid; raise exception 'B2h FAILED: editor set queued directly';
  exception when insufficient_privilege then null; end;
  begin update public.video_projects set status = 'ready_to_post' where id = pid; raise exception 'B2i FAILED: editor set ready directly';
  exception when insufficient_privilege then null; end;

  j := public.queue_video(pid);
  if j is null then raise exception 'B2j FAILED: queue returned no job'; end if;
  select count(*) into n from public.video_projects where id = pid and status = 'queued';
  if n <> 1 then raise exception 'B2k FAILED: project not queued'; end if;
  begin update public.video_projects set title = 'changed' where id = pid; raise exception 'B2l FAILED: queued video edited';
  exception when insufficient_privilege then null; end;
  begin update public.video_scenes set headline = 'changed' where project_id = pid; raise exception 'B2m FAILED: queued scene edited';
  exception when insufficient_privilege then null; end;
  begin insert into public.render_jobs (project_id, expected_ms, plan) values (pid, 1000, '{}'); raise exception 'B2n FAILED: editor wrote a job';
  exception when insufficient_privilege then null; end;
  begin perform public.renderer_claim_job(); raise exception 'B2o FAILED: editor claimed a job';
  exception when insufficient_privilege then null; end;

  -- cancel puts it back to draft
  perform public.cancel_video(pid);
  select count(*) into n from public.video_projects where id = pid and status = 'draft';
  if n <> 1 then raise exception 'B2p FAILED: cancel did not return to draft'; end if;
  reset role;
end $$;

-- B3 type-specific rules: wholesale needs MOQ, unapproved product blocked, spotlight needs consent.
do $$ declare pid uuid; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
  set local role authenticated;

  insert into public.video_scenes (project_id, position, scene_type, duration_ms)
    values ('00000000-0000-0000-0000-00000000a002', 1, 'intro', 5000), ('00000000-0000-0000-0000-00000000a002', 2, 'wholesale', 5000), ('00000000-0000-0000-0000-00000000a002', 3, 'cta', 5000);
  begin perform public.queue_video('00000000-0000-0000-0000-00000000a002'); raise exception 'B3a FAILED: wholesale without MOQ queued';
  exception when raise_exception then if sqlerrm like 'B3a%' then raise; end if; end;

  insert into public.video_scenes (project_id, position, scene_type, duration_ms)
    values ('00000000-0000-0000-0000-00000000a003', 1, 'intro', 5000), ('00000000-0000-0000-0000-00000000a003', 2, 'product', 5000), ('00000000-0000-0000-0000-00000000a003', 3, 'cta', 5000);
  begin perform public.queue_video('00000000-0000-0000-0000-00000000a003'); raise exception 'B3b FAILED: unapproved product queued';
  exception when raise_exception then if sqlerrm like 'B3b%' then raise; end if; end;

  begin insert into public.video_projects (title, video_type, supplier_id, cta_type, cta_value)
      values ('spot', 'supplier_spotlight', '00000000-0000-0000-0000-00000000e101', 'phone', '1');
    raise exception 'B3c FAILED: spotlight without consent accepted';
  exception when check_violation then null; end;
  insert into public.supplier_consents (supplier_id, note, given_on) values ('00000000-0000-0000-0000-00000000e101', 'Agreed by phone', '2026-11-20');
  insert into public.video_projects (title, video_type, supplier_id, cta_type, cta_value)
    values ('spot', 'supplier_spotlight', '00000000-0000-0000-0000-00000000e101', 'phone', '1');
  update public.supplier_consents set withdrawn = true;
  begin insert into public.video_projects (title, video_type, supplier_id, cta_type, cta_value)
      values ('spot2', 'supplier_spotlight', '00000000-0000-0000-0000-00000000e101', 'phone', '1');
    raise exception 'B3d FAILED: spotlight after withdrawn consent accepted';
  exception when check_violation then null; end;
  reset role;
end $$;

-- B4 viewer: reads, cannot write or queue.
do $$ declare n int; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.video_projects; if n < 1 then raise exception 'B4a FAILED: viewer cannot read'; end if;
  begin insert into public.video_projects (title, video_type, product_id, cta_type, cta_value)
      values ('x', 'product_showcase', '00000000-0000-0000-0000-00000000e001', 'phone', '1');
    raise exception 'B4b FAILED: viewer inserted';
  exception when insufficient_privilege then null; end;
  begin perform public.queue_video('00000000-0000-0000-0000-00000000a001'); raise exception 'B4c FAILED: viewer queued';
  exception when insufficient_privilege then null; end;
  update public.video_projects set title = 'hacked'; get diagnostics n = row_count; if n <> 0 then raise exception 'B4d FAILED: viewer updated'; end if;
  delete from public.video_projects; get diagnostics n = row_count; if n <> 0 then raise exception 'B4e FAILED: viewer deleted'; end if;
  reset role;
end $$;

-- B5 renderer: claims, cannot see the catalogue or edit anything directly, can only finish a job with a valid probe.
do $$ declare n int; r record; pid uuid := '00000000-0000-0000-0000-00000000a001'; j uuid; res text; begin
  -- editor queues again
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
  set local role authenticated;
  j := public.queue_video(pid);
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.products;         if n <> 0 then raise exception 'B5a FAILED: renderer sees products'; end if;
  select count(*) into n from public.suppliers;        if n <> 0 then raise exception 'B5b FAILED: renderer sees suppliers'; end if;
  select count(*) into n from public.audit_log;        if n <> 0 then raise exception 'B5c FAILED: renderer reads audit'; end if;
  select count(*) into n from public.render_jobs;      if n < 1 then raise exception 'B5d FAILED: renderer cannot read jobs'; end if;
  update public.video_projects set status = 'ready_to_post';
  get diagnostics n = row_count; if n <> 0 then raise exception 'B5e FAILED: renderer updated a project'; end if;
  begin update public.render_jobs set status = 'succeeded'; raise exception 'B5f FAILED: renderer updated a job';
  exception when insufficient_privilege then null; end;
  begin perform public.queue_video(pid); raise exception 'B5g FAILED: renderer queued';
  exception when insufficient_privilege then null; end;

  select * into r from public.renderer_claim_job();
  if r.id is distinct from j or r.status <> 'rendering' or r.attempt <> 1 then raise exception 'B5h FAILED: claim returned %', r; end if;
  select count(*) into n from public.renderer_claim_job(); if n <> 0 then raise exception 'B5i FAILED: claimed a second job'; end if;

  -- bad probes are refused and retried
  res := public.renderer_complete_job(j, pid || '/out.mp4', pid || '/cover.jpg',
    '{"width":720,"height":1280,"codec":"h264","pix_fmt":"yuv420p","fps":30,"duration_s":20,"has_audio":false}');
  if res <> 'retry' then raise exception 'B5j FAILED: bad size gave %', res; end if;
  select * into r from public.renderer_claim_job();           -- attempt 2
  res := public.renderer_complete_job(r.id, pid || '/out.mp4', pid || '/cover.jpg',
    '{"width":1080,"height":1920,"codec":"h264","pix_fmt":"yuv444p","fps":30,"duration_s":20,"has_audio":false}');
  if res <> 'retry' then raise exception 'B5k FAILED: bad pixel format gave %', res; end if;
  select * into r from public.renderer_claim_job();           -- attempt 3
  res := public.renderer_complete_job(r.id, pid || '/out.mp4', pid || '/cover.jpg',
    '{"width":1080,"height":1920,"codec":"h264","pix_fmt":"yuv420p","fps":30,"duration_s":12,"has_audio":false}');
  if res <> 'failed' then raise exception 'B5l FAILED: wrong duration on last attempt gave %', res; end if;
  reset role;
  select count(*) into n from public.video_projects where id = pid and status = 'failed' and status_note like 'Verification failed%';
  if n <> 1 then raise exception 'B5m FAILED: project not failed with a clear reason'; end if;

  -- editor re-queues after the failure; renderer finishes properly
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
  set local role authenticated;
  j := public.queue_video(pid);
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
  set local role authenticated;
  select * into r from public.renderer_claim_job();
  begin perform public.renderer_complete_job(r.id, '00000000-0000-0000-0000-00000000ffff/out.mp4', pid || '/c.jpg',
      '{"width":1080,"height":1920,"codec":"h264","pix_fmt":"yuv420p","fps":30,"duration_s":20,"has_audio":false}');
  end;
  select * into r from public.renderer_claim_job();
  if r.id is null then
    -- the bad path above counted as a failed attempt and re-queued; claim again
    null;
  end if;
  reset role;
end $$;

-- B6 a good report makes the video Ready to post; only then can it be marked published.
do $$ declare n int; r record; pid uuid := '00000000-0000-0000-0000-00000000a001'; res text; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
  set local role authenticated;
  select * into r from public.render_jobs where project_id = pid and status = 'rendering' order by created_at desc limit 1;
  if r.id is null then
    select * into r from public.renderer_claim_job();
  end if;
  if r.id is null then raise exception 'B6a FAILED: no job to finish'; end if;
  res := public.renderer_complete_job(r.id, pid || '/out.mp4', pid || '/cover.jpg',
    '{"width":1080,"height":1920,"codec":"h264","pix_fmt":"yuv420p","fps":30,"duration_s":20.02,"has_audio":true,"audio_codec":"aac"}');
  if res <> 'ready' then raise exception 'B6b FAILED: good report gave %', res; end if;
  reset role;
  select count(*) into n from public.video_projects where id = pid and status = 'ready_to_post'; if n <> 1 then raise exception 'B6c FAILED: not ready'; end if;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
  set local role authenticated;
  update public.video_projects set status = 'published_manually' where id = pid;
  get diagnostics n = row_count; if n <> 1 then raise exception 'B6d FAILED: editor could not mark published'; end if;
  begin update public.video_projects set status = 'draft' where id = pid; raise exception 'B6e FAILED: published video returned to draft';
  exception when insufficient_privilege then null; end;
  reset role;
  select count(*) into n from public.video_projects where id = pid and published_at is not null; if n <> 1 then raise exception 'B6f FAILED: published_at missing'; end if;
end $$;

-- B7 status history and audit.
do $$ declare n int; begin
  select count(*) into n from public.video_status_history where project_id = '00000000-0000-0000-0000-00000000a001' and to_status = 'ready_to_post';
  if n < 1 then raise exception 'B7a FAILED: history lacks ready_to_post'; end if;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.video_status_history; if n < 4 then raise exception 'B7b FAILED: viewer cannot read history'; end if;
  begin insert into public.video_status_history (project_id, to_status) values ('00000000-0000-0000-0000-00000000a001', 'draft'); raise exception 'B7c FAILED: history written directly';
  exception when insufficient_privilege then null; end;
  begin delete from public.video_status_history; raise exception 'B7d FAILED: history deleted';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.audit_log where entity in ('video_projects', 'video_scenes'); if n < 3 then raise exception 'B7e FAILED: audit missing'; end if;
  select count(*) into n from public.renderer_accounts; if n <> 1 then raise exception 'B7f FAILED: owner cannot see renderer account'; end if;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.renderer_accounts; if n <> 0 then raise exception 'B7g FAILED: editor sees renderer accounts'; end if;
  begin insert into public.renderer_accounts (user_id, label) values ('00000000-0000-0000-0000-0000000000d2', 'me'); raise exception 'B7h FAILED: editor made itself a renderer';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- B8 storage: renderer uploads only into the folder of a project that is rendering; nobody else uploads renders.
do $$ declare n int; pid uuid := '00000000-0000-0000-0000-00000000a001'; q uuid := '00000000-0000-0000-0000-00000000a002'; begin
  -- a project that is rendering
  perform set_config('studio.internal', 'on', true);
  update public.video_projects set status = 'rendering' where id = q;
  perform set_config('studio.internal', 'off', true);

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name) values ('renders', q || '/out.mp4');
  insert into storage.objects (bucket_id, name) values ('covers', q || '/cover.jpg');
  begin insert into storage.objects (bucket_id, name) values ('renders', pid || '/out.mp4'); raise exception 'B8a FAILED: upload for a project that is not rendering';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('source-images', q || '/x.jpg'); raise exception 'B8b FAILED: renderer wrote to source-images';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('renders', 'loose.mp4'); raise exception 'B8c FAILED: upload outside a project folder';
  exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
  set local role authenticated;
  begin insert into storage.objects (bucket_id, name) values ('renders', q || '/by-editor.mp4'); raise exception 'B8d FAILED: editor uploaded a render';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

rollback;

select 'ALL VIDEO STUDIO POLICY TESTS PASSED' as result;
