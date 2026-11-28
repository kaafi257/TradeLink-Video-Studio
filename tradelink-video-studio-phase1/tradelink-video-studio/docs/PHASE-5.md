# Phase 5: Better videos, fewer manual steps, easier to use (running notes)

Approved plan order: Stage 1 Better videos, Stage 2 Fewer manual steps, Stage 3 Marketplace sync (needs its own separate "go"), Stage 4 Easier to use. Stage 3 is built: see `docs/PHASE-5-SYNC.md`.
Rules unchanged: $0, no new npm dependencies, nothing publishes automatically, Draft review stays, nothing invented.

## Stage 1 (part 1): brand font, own logo, own sound
- Renderer only; no database change, no website change, no new dependency.
- Brand font: Bricolage Grotesque Bold (SIL OFL licence file included) for Latin text; Noto Sans Ethiopic for Amharic; DejaVu if the brand font is missing. Text fitting still uses the older, wider width estimate, so text never gets cut (lines may wrap a little earlier than strictly needed).
- Logo and sound are files on the renderer PC chosen in `.env` (see `docs/WINDOWS-RENDERER.md`). Uploading them in the website is not built; that would need storage rules and a migration.
- Tests: real FFmpeg renders with the new font, with logo plus a short looped tone (AAC, exact length, passes the database format check, logo visible in the cover), and silent output unchanged without them.
- Not in this part: extra templates (new template ids need a database migration), a closing logo frame, motion polish. Planned as the next part of Stage 1.
- Font source note: fonts were taken from the npm package `@expo-google-fonts/bricolage-grotesque` (registry only, not added as a dependency), file and licence copied into `renderer/fonts/`.

## Stage 1 (part 2): website redesign (look only, same features)
- New design system in `src/styles/tokens.css`: light and dark themes (dark follows the device until the person uses the sun/moon button; the choice is saved in the browser). Brand deep blue and gold kept.
- Top bar with icons and a gold underline; on phones the main menu becomes a bottom tab bar. Dashboard has a hero panel with a Quick create button and clickable cards. Cards, forms, buttons, chips, sheets and the quality/suggestion panels restyled using tokens only.
- Self-hosted web fonts added to `public/fonts` (Bricolage Grotesque Bold, Public Sans Regular/SemiBold/Bold, licences included). Amharic still uses Noto Sans Ethiopic.
- Fixed an old layout bug: two-column form rows did not collapse on phones.
- No feature, database or dependency change. Tests: vitest 97, browser suites 97 + 66, plus 113 checks in a screenshot run (light and dark, desktop and phone, no sideways scrolling).
- Not checked: Amharic screens in real browsers, very old browsers, and a real iPhone/Android device.

Stage A (fewer steps per video) is built: see `docs/PHASE-5-STAGE-A.md`.

Stage B (batch create) is built: see `docs/PHASE-5-STAGE-B.md`.

Stage Q (video quality and polish) is built: see `docs/PHASE-5-STAGE-Q.md`.
