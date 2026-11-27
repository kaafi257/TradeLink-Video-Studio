# Phase 5 Stage A — fewer steps per video

- **Create, check and queue** (Quick create): builds the draft, runs the quality check, fixes safe wording problems once, checks again and queues it. If a problem is left it stays a Draft and the editor lists what to fix. The old "Create draft in one click" button is still there (stops at Draft).
- **Fix automatically** (video editor → Quality check): re-takes the wording of the flagged scenes (stale price, stale minimum order, text that does not fit, unsupported wording, contact line) and an empty caption from approved catalogue data. Timing and pictures are never changed. Words you typed in the flagged scenes are replaced. It never fixes missing data (no image, no consent, fewer than 3 scenes): add that data first.
- **Three more templates:** Minimal Product, Wholesale Bold, Campaign Minimal. Needs migration `0009_more_templates.sql` (owner runs it; rollback in `supabase/review/`). Without 0009 the new templates cannot be saved on a video.
- **Closing frame** (renderer): last second shows the logo or TradeLink name on brand blue; same video length; `CLOSING_FRAME=off` disables it. Restart the renderer after updating.
- Nothing publishes automatically. Draft review is unchanged except that "Create, check and queue" is your choice to skip it. Cost $0, no new dependencies.

Tests: vitest (incl. 4 new for check/fix/queue), renderer tests incl. real FFmpeg closing-frame checks (colour, length, off, short last scene, own logo), browser suites for the new button and the fix.
Not tested: real Windows renderer, real Supabase, Amharic on devices.
