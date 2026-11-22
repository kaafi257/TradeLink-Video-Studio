# TradeLink Video Studio: rules for Claude Code

This repository is TradeLink Video Studio, a SEPARATE website that makes vertical
TikTok promotional videos (MP4) from a copy of the TradeLink catalogue. It is
independent of the TradeLink marketplace. Read this file at the start of every session.

## Non-negotiable rules

1. Never touch the TradeLink marketplace: not its repository, database, authentication,
   deployment or settings. Work only inside this repository's folder. Do not open or copy
   marketplace source files, and never ask the owner for marketplace credentials.
2. Never request, store, print or use a service-role or secret key belonging to the
   marketplace. Phase 1 does not contact the marketplace at all.
3. Secrets never go in the repository, logs, screenshots or chat. Only public values may use
   a VITE_ prefix. `.env.local` is git-ignored; `.env.example` holds placeholders only.
4. Database changes are SQL files in `supabase/migrations`. NEVER apply them. Do not run any
   command that links, pushes, resets or deploys to a hosted Supabase project
   (for example `supabase link`, `db push`, `db reset --linked`, `functions deploy`).
   CI holds no database credentials. The Supabase GitHub integration stays disconnected.
   A throwaway local database in Docker may be used for tests only if the owner confirms.
5. Do not invent business data: no prices, product or supplier names, performance figures,
   posting-time claims, hashtags, captions or translations presented as final. Use clearly
   labelled placeholders. All Amharic wording is marked DRAFT until a native speaker approves.
6. The business plan has not been supplied. Do not assume business details. If a task seems
   to need one, stop and ask.
7. No automatic TikTok publishing. Videos are downloaded and posted by hand.
8. Stop and ask before: adding a dependency not on the approved list, changing the
   architecture, creating any account or project, or running a command that reaches a
   network service other than the package registry and this repository's git remote.

## Architecture in brief

- Web app: React + TypeScript + Vite, plain CSS with design tokens, deployed on its own Vercel project.
- Backend: its own Supabase project (Auth, Postgres with row-level security, private Storage,
  Edge Functions). Public sign-up is disabled; one owner at first, roles owner/editor/viewer.
- Rendering (later phases): FFmpeg run by GitHub Actions. 1080x1920, 30 fps, H.264, yuv420p.
- Marketplace link (Phase 2, not before): one-way, read-only copy of the catalogue.

## Marketplace integration rules (for Phase 2; do not build in Phase 1)

- Only the ten verified public views: public_campaign, public_categories, public_contact,
  public_industries, public_product_images, public_products, public_promo_products,
  public_promotions, public_supplier_categories, public_suppliers.
- Request explicit column lists from the verified allowlist (docs/MARKETPLACE_INTEGRATION.md).
  Never `select=*`. Reject any response containing an unexpected column.
- HTTP GET only, to fixed view paths. No RPC/function calls, no base tables, no discovery
  (no schema listing, no OpenAPI, no other schema headers), no supplier-documents bucket.
- Marketplace address and publishable key live only in Edge Function secrets.
- Paginate in pages of at most 500 rows ordered by id; any failed page fails the whole sync.
- The repository migrations of the marketplace are incomplete compared with its live
  database. Never rely on them; rely on the verified allowlist.

## Conventions

- TypeScript strict mode. ESLint + Prettier. Vitest for unit tests.
- Approved dependencies for Phase 1: react, react-dom, react-router-dom, @supabase/supabase-js,
  zod, vite, typescript, vitest, eslint, prettier and their direct plugins/types. Ask before others.
- Fonts are self-hosted (no external font or script requests): Bricolage Grotesque, Archivo,
  Public Sans (Latin) and Noto Sans Ethiopic (Amharic), each with its open licence file.
- All user-facing text lives in dictionaries for `en` and `am`. Amharic strings carry a DRAFT flag.
- Brand tokens come from the verified TradeLink values: deep blue #0b4f86, ocean #0b6bb0,
  teal-blue #1479c2, bright blue #087bd4, gold #e9a914, light gold #f6c54a, ink #163d5d,
  muted #687b76, line #e5e9e7, page #f8f9fa, navy #073256.
- Currency shown as ETB (English) or Birr in Ethiopic script (Amharic). Dates numeric (DD/MM/YYYY).

## Workflow

1. Start each task with a short written plan and wait for the owner's approval.
2. Work on a branch named `phase-N` and open a pull request; never push to `main` directly.
3. Small commits with clear messages. Run lint, type check and tests before each commit.
4. End each phase with: a summary, what was tested and the results, anything not done,
   and the migration files awaiting the owner's review.
5. Report problems plainly. Do not hide failures or skip tests.
