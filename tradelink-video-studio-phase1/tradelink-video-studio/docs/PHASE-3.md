# Phase 3: Automatic Video Studio (work in progress)

Status: Stage 1 (database) written and tested on a throwaway local database. NOT applied to the Studio project.

## Stage 1: `supabase/migrations/0005_video_studio.sql`
Requires 0001, 0002 and 0004. Run it ONCE in the Studio project's SQL Editor, only after review. Then run
`supabase/review/0005_video_studio.policy-tests.sql` (rolls back, saves nothing; success = one row
"ALL VIDEO STUDIO POLICY TESTS PASSED"). Undo with `supabase/review/0005_video_studio.rollback.sql`.

Tables: `video_projects`, `video_scenes`, `render_jobs`, `video_status_history`, `supplier_consents`, `renderer_accounts`.
Statuses: draft, queued, rendering, failed, ready_to_post, published_manually, archived.

Rules enforced by the database, not only the app:
- Owners/editors create and edit drafts, queue (`queue_video`), cancel (`cancel_video`), archive, and mark "Published manually".
- Queueing needs an active product with an approved image, at least 3 scenes whose times match the video length,
  scene images only from the catalogue folders, a minimum order quantity for Wholesale Offers, and a recorded,
  not-withdrawn supplier consent for Supplier Spotlight.
- Queued and rendering videos cannot be edited.
- Only the renderer's three functions can set Rendering or Ready to post. "Ready to post" is refused unless the
  reported ffprobe facts are 1080x1920, h264, yuv420p, 30 fps, correct length (and aac if there is audio).
  A failed check retries up to 3 times, then the video shows Failed with the reason.
- Status history is append-only and every change is audited (column names only).

## Renderer account (one-time, owner)
1. Supabase → Authentication → Users → Add user (email + strong password; keep it only on the renderer PC).
2. Leave that user's profile INACTIVE (it must not be able to read the catalogue).
3. In the SQL Editor run (replace the email):
   `insert into public.renderer_accounts (user_id, label) select id, 'Windows renderer' from auth.users where email = 'renderer@example.com';`
The renderer never receives a service-role key.

## Not built yet
Stage 2 scene generator, Stage 3 wizard UI, Stage 4 Windows renderer, Stage 5 export package and install guide.
