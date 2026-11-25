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
