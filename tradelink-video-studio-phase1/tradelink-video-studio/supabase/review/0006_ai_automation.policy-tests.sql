-- POLICY TESTS for 0006. Run in the Studio SQL editor AFTER 0001, 0002, 0004, 0005 and 0006. One transaction, ends with ROLLBACK.
-- Success = a result row "ALL AI AUTOMATION POLICY TESTS PASSED" at the end; any failure raises an exception naming the test.
-- Nothing is saved: the fake users and rows exist only inside this transaction.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'ai-owner@example.invalid'),
  ('00000000-0000-0000-0000-0000000000f2', 'ai-editor@example.invalid'),
  ('00000000-0000-0000-0000-0000000000f3', 'ai-viewer@example.invalid'),
  ('00000000-0000-0000-0000-0000000000f4', 'ai-renderer@example.invalid');
update public.profiles set role = 'owner',  active = true where id = '00000000-0000-0000-0000-0000000000f1';
update public.profiles set role = 'editor', active = true where id = '00000000-0000-0000-0000-0000000000f2';
update public.profiles set role = 'viewer', active = true where id = '00000000-0000-0000-0000-0000000000f3';
insert into public.renderer_accounts (user_id, label) values ('00000000-0000-0000-0000-0000000000f4', 'test renderer');

insert into public.products (id, name, brand, description, image_path, image_approved, min_order_quantity, retail_price, unit) values
  ('00000000-0000-0000-0000-00000000e501', 'Prod AI', 'BrandX', 'Fine rice', 'products/a.jpg', true, 12, 120.00, 'bag');
insert into public.products (id, name, image_path, image_approved) values
  ('00000000-0000-0000-0000-00000000e502', 'Secret other product', 'products/z.jpg', true);

insert into public.video_projects (id, title, video_type, product_id, cta_type, cta_value, duration_seconds) values
  ('00000000-0000-0000-0000-00000000a501', 'AI V1', 'product_showcase', '00000000-0000-0000-0000-00000000e501', 'phone', '+251911000000', 15),
  ('00000000-0000-0000-0000-00000000a502', 'AI V2', 'product_showcase', '00000000-0000-0000-0000-00000000e501', 'phone', '+251911000000', 15);
insert into public.video_scenes (project_id, position, scene_type, duration_ms, headline, image_path, animation) values
  ('00000000-0000-0000-0000-00000000a501', 1, 'intro', 5000, 'Prod AI', 'products/a.jpg', 'zoom_in'),
  ('00000000-0000-0000-0000-00000000a501', 2, 'product', 5000, 'BrandX', 'products/a.jpg', 'pan_left'),
  ('00000000-0000-0000-0000-00000000a501', 3, 'cta', 5000, 'Call', null, 'fade');

-- C1 anonymous has no access.
do $$ begin
  set local role anon;
  begin perform count(*) from public.copy_jobs; raise exception 'C1 FAILED: anon read copy_jobs';
  exception when insufficient_privilege then null; end;
  begin perform public.request_copy_job('00000000-0000-0000-0000-00000000a501'); raise exception 'C1 FAILED: anon requested a job';
  exception when insufficient_privilege then null; end;
  begin perform public.save_quality_report('00000000-0000-0000-0000-00000000a501', '{"status":"pass","checks":[]}'); raise exception 'C1 FAILED: anon saved a report';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- C2 languages, templates, copy source.
do $$ declare pid uuid := '00000000-0000-0000-0000-00000000a502'; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;
  update public.video_projects set language = 'so', template_id = 'bold_sale', copy_source = 'rules' where id = pid;
  update public.video_projects set language = 'am' where id = pid;
  update public.video_projects set language = 'en' where id = pid;
  begin update public.video_projects set language = 'fr' where id = pid; raise exception 'C2a FAILED: French accepted';
  exception when check_violation then null; end;
  begin update public.video_projects set template_id = 'made_up' where id = pid; raise exception 'C2b FAILED: unknown template accepted';
  exception when check_violation then null; end;
  begin update public.video_projects set copy_source = 'robot' where id = pid; raise exception 'C2c FAILED: unknown copy source accepted';
  exception when check_violation then null; end;
  reset role;
end $$;

-- C3 quality report: only the function writes it; a "fail" blocks queueing; a pass allows it.
do $$ declare pid uuid := '00000000-0000-0000-0000-00000000a501'; j uuid; pl jsonb; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;
  begin update public.video_projects set quality_report = '{"status":"pass","checks":[]}' where id = pid;
    raise exception 'C3a FAILED: editor wrote quality_report directly';
  exception when insufficient_privilege then null; end;
  begin perform public.save_quality_report(pid, '{"status":"great","checks":[]}'); raise exception 'C3b FAILED: bad status accepted';
  exception when raise_exception then if sqlerrm like 'C3b%' then raise; end if; end;
  begin perform public.save_quality_report(pid, '{"status":"pass"}'); raise exception 'C3c FAILED: report without checks accepted';
  exception when raise_exception then if sqlerrm like 'C3c%' then raise; end if; end;
  begin perform public.save_quality_report(pid, '[]'); raise exception 'C3d FAILED: array report accepted';
  exception when raise_exception then if sqlerrm like 'C3d%' then raise; end if; end;

  perform public.save_quality_report(pid, '{"status":"fail","checks":[{"id":"text_fit","status":"fail"}],"extra":"dropped"}');
  begin perform public.queue_video(pid); raise exception 'C3e FAILED: queued despite a failed quality check';
  exception when raise_exception then if sqlerrm like 'C3e%' then raise; end if; end;
  if (select quality_report ? 'extra' from public.video_projects where id = pid) then raise exception 'C3f FAILED: unexpected report keys kept'; end if;

  perform public.save_quality_report(pid, '{"status":"warn","checks":[{"id":"x","status":"warn"}]}');
  update public.video_projects set template_id = 'clean_product' where id = pid;
  j := public.queue_video(pid);
  select r.plan into pl from public.render_jobs r where r.id = j;
  if pl -> 'project' ->> 'template_id' is distinct from 'clean_product' then raise exception 'C3g FAILED: template missing from the frozen plan'; end if;
  -- queued videos are frozen and cannot take a report
  begin perform public.save_quality_report(pid, '{"status":"pass","checks":[]}'); raise exception 'C3h FAILED: report saved on a queued video';
  exception when raise_exception then if sqlerrm like 'C3h%' then raise; end if; end;
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}', true);
  set local role authenticated;
  begin perform public.save_quality_report('00000000-0000-0000-0000-00000000a502', '{"status":"pass","checks":[]}'); raise exception 'C3i FAILED: viewer saved a report';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- C4 claims guard (unit): invented numbers, percentages, links, handles and marketing claims are refused.
do $$ declare facts text := '{"product":{"name":"Prod AI","retail_price":1200.50,"sale_price":99}}'; begin
  if public.claims_problem('Fresh rice for your shop', facts) is not null then raise exception 'C4a FAILED: clean text refused'; end if;
  if public.claims_problem('Only ETB 1,200.50 today', facts) is not null and public.claims_problem('ETB 1,200.50', facts) is not null
    then raise exception 'C4b FAILED: a price from the data was refused'; end if;
  if public.claims_problem('ETB 850', facts) is null then raise exception 'C4c FAILED: invented price accepted'; end if;
  if public.claims_problem('Save 20% now', facts) is null then raise exception 'C4d FAILED: percentage accepted'; end if;
  if public.claims_problem('Visit www.shop.com', facts) is null then raise exception 'C4e FAILED: link accepted'; end if;
  if public.claims_problem('Call @mybrand', facts) is null then raise exception 'C4f FAILED: handle accepted'; end if;
  if public.claims_problem('The best rice in town', facts) is null then raise exception 'C4g FAILED: "best" accepted'; end if;
  if public.claims_problem('Guaranteed quality', facts) is null then raise exception 'C4h FAILED: "guaranteed" accepted'; end if;
  if public.claims_problem('Waa ugu fiican', facts) is null then raise exception 'C4i FAILED: Somali "best" accepted'; end if;
  if public.claims_problem('ምርጥ ሩዝ', facts) is null then raise exception 'C4j FAILED: Amharic "best" accepted'; end if;
  if public.claims_problem('ዋጋ ፭ ብር', facts) is null then raise exception 'C4k FAILED: Ethiopic numeral accepted'; end if;
  if public.claims_problem('<b>x</b>', facts) is null then raise exception 'C4l FAILED: markup accepted'; end if;
  if public.claims_problem('free delivery', '{"note":"free delivery"}') is not null then raise exception 'C4m FAILED: a word present in the data was refused'; end if;
  if public.claims_problem('Prod AI is a bestseller', facts) is not null then raise exception 'C4n FAILED: "bestseller" wrongly matched "best"'; end if;
end $$;

-- C5 requesting suggestions.
do $$ declare pid uuid := '00000000-0000-0000-0000-00000000a502'; j uuid; f jsonb; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}', true);
  set local role authenticated;
  begin perform public.request_copy_job(pid); raise exception 'C5a FAILED: viewer requested suggestions';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}', true);
  set local role authenticated;
  begin perform public.request_copy_job(pid); raise exception 'C5b FAILED: renderer requested suggestions';
  exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;
  j := public.request_copy_job(pid);
  select facts into f from public.copy_jobs where id = j;
  if f -> 'product' ->> 'name' is distinct from 'Prod AI' or (f -> 'product' ->> 'retail_price')::numeric <> 120 then raise exception 'C5c FAILED: facts missing'; end if;
  if f::text like '%Secret other product%' then raise exception 'C5d FAILED: facts leaked another product'; end if;
  begin perform public.request_copy_job(pid, 'caption'); raise exception 'C5e FAILED: second open request accepted';
  exception when raise_exception then if sqlerrm like 'C5e%' then raise; end if; end;
  begin perform public.request_copy_job(pid, 'scene', null); raise exception 'C5f FAILED: scene scope without a scene accepted';
  exception when raise_exception or check_violation then if sqlerrm like 'C5f%' then raise; end if; end;
  begin update public.copy_jobs set status = 'succeeded' where id = j; raise exception 'C5g FAILED: editor updated a copy job directly';
  exception when insufficient_privilege then null; end;
  begin insert into public.copy_jobs (project_id, language, facts) values (pid, 'en', '{}'); raise exception 'C5h FAILED: editor inserted a copy job directly';
  exception when insufficient_privilege then null; end;
  perform public.cancel_copy_job(j);
  begin perform public.cancel_copy_job(j); raise exception 'C5i FAILED: cancelled twice';
  exception when raise_exception then if sqlerrm like 'C5i%' then raise; end if; end;
  -- a queued video cannot get new requests
  begin perform public.request_copy_job('00000000-0000-0000-0000-00000000a501'); raise exception 'C5j FAILED: request on a queued video accepted';
  exception when raise_exception then if sqlerrm like 'C5j%' then raise; end if; end;
  reset role;
  if (select count(*) from public.copy_jobs where status = 'queued') <> 0 then raise exception 'C5k FAILED: cancelled job still queued'; end if;
end $$;

-- C6 the renderer login claims and completes jobs; the guard is enforced; nothing is applied automatically.
do $$ declare pid uuid := '00000000-0000-0000-0000-00000000a502'; j uuid; c public.copy_jobs%rowtype; r text; head_before text; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;
  j := public.request_copy_job(pid);
  begin perform * from public.copy_claim_job(); raise exception 'C6a FAILED: editor claimed a copy job';
  exception when insufficient_privilege then null; end;
  reset role;

  select headline into head_before from public.video_scenes where project_id = '00000000-0000-0000-0000-00000000a501' and position = 1;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}', true);
  set local role authenticated;
  if (select count(*) from public.copy_jobs) <> 0 then raise exception 'C6b FAILED: renderer read copy_jobs directly'; end if;
  select * into c from public.copy_claim_job();
  if c.id is distinct from j or c.status <> 'running' or c.attempt <> 1 then raise exception 'C6c FAILED: claim did not return the running job'; end if;
  if c.facts ->> 'language' is null then raise exception 'C6d FAILED: claim returned no facts'; end if;

  -- invented price: the job is retried, not stored
  r := public.copy_complete_job(j, '{"scenes":[{"position":1,"headline":"Only ETB 85 today"}]}', 'local_ai', 'test-model');
  if r <> 'retry' then raise exception 'C6e FAILED: invented price not refused (%)', r; end if;
  select * into c from public.copy_claim_job();
  r := public.copy_complete_job(j, '{"caption":"Best rice, 100% pure"}', 'local_ai', 'test-model');
  if r <> 'failed' then raise exception 'C6f FAILED: marketing claim not refused (%)', r; end if;
  reset role;
  if (select result from public.copy_jobs where id = j) is not null then raise exception 'C6g FAILED: a refused result was stored'; end if;
  if (select error_message from public.copy_jobs where id = j) not like 'Claims guard:%' then raise exception 'C6h FAILED: no reason recorded'; end if;

  -- a clean second job succeeds; unexpected keys are dropped; scene text is NOT changed automatically
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;
  j := public.request_copy_job(pid, 'all');
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}', true);
  set local role authenticated;
  select * into c from public.copy_claim_job();
  r := public.copy_complete_job(c.id, '{"scenes":[{"position":1,"headline":"Prod AI by BrandX","evil":"x"},{"position":2,"body":"Fine rice, 12 per order"}],"caption":"Fine rice for your shop.","hashtags":["rice","BrandX"],"other":1}', 'local_ai', 'test-model');
  if r <> 'ok' then raise exception 'C6i FAILED: clean result refused (%)', r; end if;
  begin perform public.copy_complete_job(c.id, '{}', 'x', 'y'); raise exception 'C6j FAILED: completed twice';
  exception when raise_exception then if sqlerrm like 'C6j%' then raise; end if; end;
  reset role;
  if (select result ? 'other' from public.copy_jobs where id = c.id) then raise exception 'C6k FAILED: extra keys stored'; end if;
  if (select result -> 'scenes' -> 0 ? 'evil' from public.copy_jobs where id = c.id) then raise exception 'C6l FAILED: extra scene keys stored'; end if;
  if (select headline from public.video_scenes where project_id = '00000000-0000-0000-0000-00000000a501' and position = 1) is distinct from head_before then
    raise exception 'C6m FAILED: scene text changed without a person applying it'; end if;
  if (select provider from public.copy_jobs where id = c.id) <> 'local_ai' then raise exception 'C6n FAILED: provider not recorded'; end if;
end $$;

-- C7 malformed results are refused; stuck jobs are reclaimed; attempts are capped.
do $$ declare pid uuid := '00000000-0000-0000-0000-00000000a502'; j uuid; c public.copy_jobs%rowtype; r text; begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  set local role authenticated;
  j := public.request_copy_job(pid);
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}', true);
  set local role authenticated;
  select * into c from public.copy_claim_job();
  r := public.copy_complete_job(j, '"just text"', 'x', 'y');
  if r <> 'retry' then raise exception 'C7a FAILED: non-object accepted'; end if;
  select * into c from public.copy_claim_job();
  r := public.copy_complete_job(j, '{"hashtags":["bad tag"]}', 'x', 'y');
  if r <> 'failed' then raise exception 'C7b FAILED: invalid hashtag accepted (%)', r; end if;
  reset role;
  update public.copy_jobs set status = 'queued', attempt = 0, error_message = null, finished_at = null where id = j;
  update public.copy_jobs set status = 'running', claimed_at = now() - interval '20 minutes', attempt = 1 where id = j;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}', true);
  set local role authenticated;
  select * into c from public.copy_claim_job();
  if c.id is distinct from j or c.attempt <> 2 then raise exception 'C7c FAILED: stuck job not reclaimed'; end if;
  r := public.copy_fail_job(j, 'model offline');
  if r <> 'failed' then raise exception 'C7d FAILED: attempts not capped (%)', r; end if;
  begin perform public.copy_fail_job(j, 'again'); raise exception 'C7e FAILED: failed a finished job';
  exception when raise_exception then if sqlerrm like 'C7e%' then raise; end if; end;
  reset role;
end $$;

rollback;

select 'ALL AI AUTOMATION POLICY TESTS PASSED' as result;
