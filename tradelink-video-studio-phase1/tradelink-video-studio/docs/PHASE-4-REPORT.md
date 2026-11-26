# Phase 4 report: AI Video Automation

Approved approach: optional local Ollama + deterministic rules/templates. No paid APIs, hosted AI, extra services or new npm dependencies.

## Delivered (all stages)
1. Foundations: migration 0006 (Somali, templates, copy source, quality report, copy-job queue, database claims guard).
2. Copy engine + claims guard (app side, 40/40 parity with the database guard).
3. Six templates in the renderer, Quick create page (one click, stops at Draft).
4. Quality Assistant: 18 checks, fail blocks queueing (app and database), dark-picture warnings from the renderer.
5. Optional local AI worker, "Suggested wording" panel, migration 0007 (scene context).

## Tested
Vitest 97/97; renderer tests 42/42 (including real FFmpeg renders of all six templates); browser suites 97/97 (videos) and 66/66 (catalogue); lint, typecheck and guard clean; database policy tests for 0005, 0006 and 0007 pass on a local Postgres 16 with rollback and re-apply checked.

## Not tested
- Against your live Supabase project or Windows PC (migrations 0006/0007 not yet applied; renderer account not yet created).
- A real Ollama model (the worker was tested against a fake Ollama server). Real model quality, speed and Somali/Amharic output are unknown.

## Your actions
1. Supabase SQL Editor: apply `0006_ai_automation.sql`, run its policy tests, then apply `0007_copy_scene_context.sql` and run its tests (steps in `docs/PHASE-4.md`).
2. Finish Phase 3 renderer setup if not done (`docs/WINDOWS-RENDERER.md`).
3. Optional: decide whether to install Ollama.
4. Have native speakers review all Somali and Amharic wording and the claim-word lists; they stay DRAFT until then.

## Known gaps
Somali app-interface text is not translated (video content works in Somali); brand fonts missing; wholesale videos need price and MOQ data (e.g. YOONIKK Men); a small "(optional)" legend wording glitch on Quick create; the quality gate guards mistakes, not a malicious editor.
