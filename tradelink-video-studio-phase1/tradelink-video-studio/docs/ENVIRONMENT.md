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
