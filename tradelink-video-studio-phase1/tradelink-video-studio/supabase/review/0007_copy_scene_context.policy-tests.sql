-- POLICY TESTS for 0007 (run after 0001, 0002, 0004, 0005, 0006, 0007). One transaction, ends with ROLLBACK; saves nothing.
-- Success = a result row "ALL COPY SCENE CONTEXT TESTS PASSED". Any failure raises an exception naming the test.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'sc-owner@example.invalid'),
  ('00000000-0000-0000-0000-0000000000f2', 'sc-editor@example.invalid'),
  ('00000000-0000-0000-0000-0000000000f3', 'sc-viewer@example.invalid'),
  ('00000000-0000-0000-0000-0000000000f4', 'sc-renderer@example.invalid');
update public.profiles set role = 'owner',  active = true where id = '00000000-0000-0000-0000-0000000000f1';
update public.profiles set role = 'editor', active = true where id = '00000000-0000-0000-0000-0000000000f2';
update public.profiles set role = 'viewer', active = true where id = '00000000-0000-0000-0000-0000000000f3';
insert into public.renderer_accounts (user_id, label) values ('00000000-0000-0000-0000-0000000000f4', 'test renderer');

insert into public.products (id, name, image_path, image_approved, retail_price) values
  ('00000000-0000-0000-0000-00000000e501', 'Prod SC', 'products/a.jpg', true, 120.00);
insert into public.video_projects (id, title, video_type, product_id, cta_type, cta_value, duration_seconds) values
  ('00000000-0000-0000-0000-00000000a501', 'SC V1', 'product_showcase', '00000000-0000-0000-0000-00000000e501', 'phone', '+251911000000', 15);
insert into public.video_scenes (project_id, position, scene_type, duration_ms, headline, body, image_path, animation) values
  ('00000000-0000-0000-0000-00000000a501', 1, 'intro', 5000, 'Prod SC', null, 'products/a.jpg', 'zoom_in'),
  ('00000000-0000-0000-0000-00000000a501', 2, 'price', 5000, 'ETB 120.00', 'A short line', null, 'fade'),
  ('00000000-0000-0000-0000-00000000a501', 3, 'cta', 5000, 'Call: +251911000000', null, null, 'fade');

-- D1 scope 'all' carries the saved scenes in the facts.
do $$ declare pid uuid := '00000000-0000-0000-0000-00000000a501'; j uuid; f jsonb; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;
  j := public.request_copy_job(pid, 'all');
  select facts into f from public.copy_jobs where id = j;
  if jsonb_array_length(f -> 'scenes') <> 3 then raise exception 'D1a FAILED: scenes missing from the facts'; end if;
  if f -> 'scenes' -> 1 ->> 'headline' is distinct from 'ETB 120.00' or f -> 'scenes' -> 0 ? 'body' then raise exception 'D1b FAILED: scene text wrong or null kept'; end if;
  if f ? 'scene' then raise exception 'D1c FAILED: single scene in an all-scope request'; end if;
  perform public.cancel_copy_job(j);

  -- D2 scope 'scene' carries just that scene
  j := public.request_copy_job(pid, 'scene', 2);
  select facts into f from public.copy_jobs where id = j;
  if f -> 'scene' ->> 'body' is distinct from 'A short line' or f ? 'scenes' then raise exception 'D2 FAILED: scene facts wrong'; end if;
  perform public.cancel_copy_job(j);

  -- D3 an unknown scene is refused
  begin perform public.request_copy_job(pid, 'scene', 9); raise exception 'D3 FAILED: unknown scene accepted';
  exception when raise_exception then if sqlerrm like 'D3%' then raise; end if; end;

  -- caption scope has neither
  j := public.request_copy_job(pid, 'caption');
  select facts into f from public.copy_jobs where id = j;
  if f ? 'scenes' or f ? 'scene' then raise exception 'D4 FAILED: caption request carries scenes'; end if;
  perform public.cancel_copy_job(j);
  reset role;

  -- D5 viewer and renderer still cannot request
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}', true);
  set local role authenticated;
  begin perform public.request_copy_job(pid, 'all'); raise exception 'D5a FAILED: viewer requested';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}', true);
  set local role authenticated;
  begin perform public.request_copy_job(pid, 'all'); raise exception 'D5b FAILED: renderer requested';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- D6 the guard lets the model reuse a number from the scene wording and still refuses invented ones.
do $$ declare pid uuid := '00000000-0000-0000-0000-00000000a501'; j uuid; c public.copy_jobs%rowtype; r text; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;
  j := public.request_copy_job(pid, 'scene', 2);
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}', true);
  set local role authenticated;
  select * into c from public.copy_claim_job();
  if c.facts -> 'scene' ->> 'position' <> '2' then raise exception 'D6a FAILED: claimed job has no scene'; end if;
  r := public.copy_complete_job(j, '{"scenes":[{"position":2,"headline":"Only ETB 99.00"}]}', 'ollama', 'm');
  if r <> 'retry' then raise exception 'D6b FAILED: invented price accepted (%)', r; end if;
  select * into c from public.copy_claim_job();
  r := public.copy_complete_job(j, '{"scenes":[{"position":2,"headline":"ETB 120.00","body":"A short line"}]}', 'ollama', 'm');
  if r <> 'ok' then raise exception 'D6c FAILED: scene wording refused (%)', r; end if;
  r := null;
  reset role;
  if (select result -> 'scenes' -> 0 ->> 'headline' from public.copy_jobs where id = j) <> 'ETB 120.00' then raise exception 'D6d FAILED: result not stored'; end if;
end $$;

rollback;

select 'ALL COPY SCENE CONTEXT TESTS PASSED' as result;
