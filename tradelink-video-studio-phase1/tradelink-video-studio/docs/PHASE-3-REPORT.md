# Phase 3 completion report: Automatic Video Studio

## What was built
| Stage | What | Status |
|---|---|---|
| 1 | Database `0005_video_studio.sql`: projects, scenes, render jobs, status history, renderer registry, queue/cancel/renderer functions, storage policies | Applied live, live policy test passed |
| 2 | Scene-plan generator `src/lib/scenes.ts` (approved data only) | Merged (PR #5) |
| 3 | Videos list, New video wizard, scene editor | Merged (PR #6) |
| 4 | Local Windows renderer (`renderer/`), install guide | Merged (PR #7) |
| 5 | Export panel: verified file facts, caption, hashtags, suggested time, downloads | This PR |

## How a video moves
Draft → Queued → Rendering → Ready to post → Published manually (or Failed / Archived).
Only the renderer can make a video Ready, and only after the database confirms the ffprobe facts:
1080×1920, H.264, yuv420p, 30 fps, length within 0.6 s of the plan, AAC only if there is sound.
Nothing posts to TikTok automatically.

## Tested
- Live: 0005 policy tests passed on your Supabase project.
- Local database: all policy tests (B1–B8).
- 51 app unit tests, 51 UI checks (Playwright, mock backend), lint, typecheck, secrets guard.
- 19 renderer tests with real FFmpeg: three real 20 s renders (premium/dynamic/minimal), every animation, Amharic text, missing image, wrong length, missing FFmpeg, key guard.

## Not tested / not done
- Renderer against the live project and on Windows: needs the renderer account (see `docs/WINDOWS-RENDERER.md`). First real run = `npm run check`, then `npm run once` with one queued video.
- No sound or music (none bundled; add sound in TikTok).
- Fonts: DejaVu Sans Bold and Noto Sans Ethiopic Bold are interim. Brand fonts (Public Sans, Bricolage Grotesque, Archivo) are not in the repo.
- Amharic wording is DRAFT until a native speaker approves it.
- "Suggested posting time" is only your own note; the Studio makes no timing claims.
- The product YOONIKK Men still has no price or minimum order quantity; wholesale videos cannot be queued until you add them.
- Reveal animation is rendered as a slow fade.

## Awaiting your action
1. Create the renderer login and register it (SQL in `docs/WINDOWS-RENDERER.md`).
2. Install Node 22 and FFmpeg on the Windows PC, run `npm run check`.
3. Queue one video in the Studio and run `npm run once`; tell me the result.
