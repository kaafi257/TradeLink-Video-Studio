# Environment variables

| Variable | Where it goes | Public? | Needed in |
| --- | --- | --- | --- |
| VITE_STUDIO_SUPABASE_URL | Vercel project settings and local `.env.local` | Public | Phase 1 |
| VITE_STUDIO_SUPABASE_PUBLISHABLE_KEY | Vercel project settings and local `.env.local` | Public | Phase 1 |

Later phases (names are proposals, confirmed when each phase starts): MARKETPLACE_URL and
MARKETPLACE_PUBLISHABLE_KEY (Studio Supabase Edge Function secrets, Phase 2); NIGHTLY_SYNC_SECRET
(Phase 2); GITHUB_DISPATCH_TOKEN (Edge Function secret, Phase 3); STUDIO_SUPABASE_URL and
STUDIO_SUPABASE_SECRET_KEY (GitHub Actions secrets, Phase 3).

Never put a secret in a `VITE_` variable: those values are published in the web pages.

## Phase 2 (Edge Function secrets in the Studio project; never VITE_ and never in git)

| Secret | Purpose |
| --- | --- |
| MARKETPLACE_URL | Plain https address of the marketplace Supabase project |
| MARKETPLACE_PUBLISHABLE_KEY | The marketplace's PUBLISHABLE (anon) key only |
| NIGHTLY_SYNC_SECRET | Long random value the scheduler sends in the `x-sync-secret` header |
