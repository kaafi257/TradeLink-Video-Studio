# Phase 2: independent catalogue (built, NOT deployed, NOT applied)

The Studio keeps its own catalogue in its own Supabase project. It never contacts the TradeLink marketplace.
The marketplace sync from the earlier Phase 2 draft was removed (see "Removed" below).

## What was built
- Catalogue section: Overview, Products, Categories, Suppliers, Campaigns, Sync Settings (display only).
- Products: add, edit, details, image upload/replace/remove, activate/deactivate, search, category and status
  filters, sorting, delete with confirmation. Nothing is pre-filled; blank optional fields stay empty.
- Image approval: a product is usable for video only when it is active and its image is approved
  (`videoEligible()` in `src/lib/catalogue.ts`). Approval needs an image; changing the image resets approval.
- Amharic UI text (DRAFT, needs native-speaker review). Noto Sans Ethiopic (OFL) is included in `public/fonts`.

## Database: `supabase/migrations/0004_catalogue.sql` (apply yourself, after 0001 to 0003)
Tables: `categories`, `suppliers`, `products`, `campaigns`, `campaign_products`. Empty. Constraints: prices >= 0,
sale price needs a retail price and must be lower, approval needs an image, campaign end >= start, unique
category and supplier names (case-insensitive). It also drops the unused 0003 sync tables if present.
Security: RLS on every table. Members read; editors and the owner insert, update, delete; viewers read only; anon nothing.
`created_*` and `updated_*` can only be set by triggers (column-level grants). Changes are written to `audit_log`
(column names only). Rollback: `supabase/review/0004_catalogue.rollback.sql`.

## Storage
Reuses the private `source-images` bucket (10 MB; JPEG, PNG, WebP). Folders: products/, categories/, suppliers/,
campaigns/. New policies: members read; editors and owner upload and delete inside those folders only.
Images are shown through temporary signed links.

## Tests
- SQL: `supabase/review/0004_catalogue.policy-tests.sql` (run it after applying; expect "ALL CATALOGUE POLICY TESTS PASSED").
- Unit tests for the catalogue rules; lint, typecheck and build.
- Browser test (Playwright, phone and desktop) against a simulated backend. It is not a real Supabase project.

## Removed
The `sync-catalogue` Edge Function, its shared modules and tests, and the old Catalogue sync page. The code remains in
git history. Marketplace sync may only be built in a later, separately approved phase.

## Not verified
- Anything against your real Supabase project (apply 0004, then try it).
- Byte-level image upload in the browser test (the simulated storage serves a stand-in picture).
- Owner sign-in with the authenticator app (the test used editor and viewer accounts).
- Amharic wording; the other Studio font files (Public Sans, Bricolage Grotesque) are still missing from `public/fonts`.
