# Phase 4: AI Video Automation (running notes)

Plan: `docs/PHASE-4-PLAN.md`. Approved decisions: local Ollama (optional) + rules, no hosted AI or paid API, Somali and Amharic stay
DRAFT, six templates, one-click stops at Draft, no new npm dependencies, nothing publishes automatically.

## Stage 1: foundations (this stage)
- `supabase/migrations/0006_ai_automation.sql` (FOR YOUR REVIEW, not applied): Somali video language, `template_id`, `copy_source`,
  quality report (written only by `save_quality_report()`), `queue_video()` refuses a saved "fail" report, `copy_jobs` queue and
  functions for the optional local AI, claims guard in the database (`claims_problem()`).
- `supabase/review/0006_ai_automation.policy-tests.sql` and `0006_ai_automation.rollback.sql`.
- `src/lib/templates.ts` (six templates), Somali labels in `src/lib/scenes.ts`, Somali choice in the wizard, DRAFT notice for Somali.

### How to apply (when you approve)
1. Supabase SQL Editor: run the whole file `0006_ai_automation.sql` once. It will fail with "already exists" if run twice; that is safe, do not re-run.
2. Run `0006_ai_automation.policy-tests.sql`. Success = one row "ALL AI AUTOMATION POLICY TESTS PASSED". It saves nothing.
3. Optional: run the 0005 policy tests again to confirm nothing changed.

### Safety notes
- The AI never writes into a video. Suggestions are stored in `copy_jobs.result`; a person reviews and applies them (Stage 5).
- The facts sent to a model are built inside the database from approved catalogue rows only.
- Claims guard blocks numbers/prices not in the data, percentages, links, handles and marketing claims. The Somali and Amharic word lists are unverified drafts.
- The quality gate is a guardrail against mistakes, not against a malicious editor (editors can already queue valid videos).

## Stage 2: copy engine and claims guard (app side)
- `src/lib/claimsGuard.ts`: the same rules as `claims_problem()` in 0006 (no invented numbers, percentages, links, handles or marketing claims). Checked against the database guard on 40 sample phrases: 40/40 agree.
- `src/lib/copy.ts`: `buildFacts` (approved fields only), rule-based caption and hashtags for English, Somali and Amharic (DRAFT), scene shortening, and `runCopy()`, which applies the guard and limits to EVERY provider and lists what it dropped. `applySuggestion` records where applied text came from (`rules` / `local_ai`).
- Not wired into screens yet: the one-click page (Stage 3) and "Improve copy" buttons (Stage 5) will use it. No new dependencies.

## Stage 3: templates in the renderer, Quick create, template choice in the wizard
- Renderer: `renderer/src/templates.js` tweaks layout and fades per template (bigger sale price, thicker accent bar, taller wholesale button, quicker fades). Templates never change the words. Without a template, output is identical to Phase 3. Real renders were run for all six templates (all pass the ffprobe check) and frames were checked by eye.
- App: `src/lib/videoCreate.ts` and `useVideoCatalogue.ts` are now the single place that loads approved data and saves a draft; the full wizard and the new Quick create page both use them (no duplicate system). The wizard has an optional Template choice. `/videos/quick` ("Quick create"): choose what to promote and a template; scenes, caption and hashtags come from approved data only; it saves a DRAFT and opens the editor. It never queues, renders or posts.
- Not done in this stage: Somali for the app's own screens (the interface is still English and Amharic; Somali works for video content). No database change in Stage 3.

## Stage 4: Quality Assistant
- `src/lib/quality.ts`: 18 rule-based checks on a DRAFT against today's approved catalogue data (scene count and timing, text fit, contact in the call to action, subject active with approved image, wholesale MOQ and no price, price/MOQ still match the catalogue, "In stock" only when in stock, supplier consent, caption limits, claims guard, DRAFT language reminder, template fit). Fail blocks queueing; warn does not. `src/lib/textFit.ts` mirrors the renderer's text-width model (a test compares them).
- Editor: a "Quality check" panel (run button, grouped results, stale notice). Pressing Queue runs the check first, saves it with `save_quality_report()` and stops on a fail. The database (0006) refuses a saved fail as well. No new database change in this stage; it uses 0006, which you must apply first.
- Renderer: after rendering it looks for very dark stretches and a dark cover and records them as a WARNING in the job report (not a failure, so a legitimately dark photo never blocks a video). The Ready-to-post panel shows the notice and the verified file facts.
- Honest limits: the quality gate guards against mistakes, not against a malicious editor; the renderer's dark-frame check is a heuristic.

## Stage 5: optional local AI and "Suggested wording"
- Migration `0007_copy_scene_context.sql` (FOR YOUR REVIEW, not applied; apply AFTER 0006): `request_copy_job` now also puts the saved scene wording in the facts (all scenes, or the one scene asked for). Re-runnable. Policy tests and rollback are in `supabase/review/`.
- Renderer (`renderer/src/copyjob.js`, `config.js`, `main.js`): OFF unless `OLLAMA_MODEL` is set in `.env`. When on, it claims a wording request only when there is no video to render, asks Ollama on THIS computer (URL must be 127.0.0.1 or localhost, otherwise the program refuses to start), and sends the answer to the database, which checks it again with the claims guard (`copy_complete_job`). Ollama not running, model missing, bad JSON, or a refused answer all end as a plain failed request. `--check` reports the local AI status. Uses Node's built-in fetch: no new dependencies. Nine new tests with a fake Ollama.
- App (`src/lib/localAi.ts`, `src/pages/videos/SuggestPanel.tsx`, editor): a "Suggested wording" panel for editable drafts. Choose scenes+caption+hashtags, caption only, or one scene. "Suggest with rules" is instant. "Improve with local AI" queues a request, waits (with a slow hint and Cancel), then shows the answer, checked a second time in the app. Nothing is applied until "Apply to the form", and nothing is saved until Save. Saved text is tagged `rules` or `local_ai` (scene chips and `copy_source`); editing it afterwards makes it "Typed by you".
- Viewers do not see the panel. Manual editing and the quick/wizard flows are unchanged.

### Turning the local AI on (optional, your decision; nothing is installed for you)
1. Install Ollama from ollama.com on the renderer PC and pull a small model yourself (for example `ollama pull llama3.2:3b`).
2. In `renderer/.env` set `OLLAMA_MODEL=llama3.2:3b` (leave `OLLAMA_URL` as is). Run `npm run check`: it should say "Local AI: ready".
3. Keep the renderer running. Without this, the "Improve with local AI" button just times out harmlessly and rules still work.
