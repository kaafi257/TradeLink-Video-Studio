# Phase 2: catalogue sync (code written, NOT deployed, NOT run)

## Plan in one paragraph
A Studio Edge Function (`sync-catalogue`) reads the ten verified public marketplace views with HTTP GET only,
500 rows per page, explicit column lists, and stores a read-only copy in the Studio database
(`catalogue_items`, with a log in `sync_runs`). The whole copy is replaced in one database transaction, so
a failed sync never leaves a half-updated catalogue. Nothing here touches the marketplace except those GETs.

## Files
- `supabase/migrations/0003_catalogue.sql` (awaiting your review; rollback and policy tests in `supabase/review/`)
- `supabase/functions/_shared/allowlist.ts`: the verified views and columns, URL builder, row and address checks
- `supabase/functions/_shared/sync.ts`: paging and "any failure fails the whole sync"
- `supabase/functions/sync-catalogue/index.ts`: the Edge Function (owner button or nightly secret)

## Safeguards built in
- Only the ten allowlisted views; `select=*` is impossible (explicit columns); rows with any extra column are rejected.
- GET only, redirects refused, 10 second timeout per page, at most 40 pages per view.
- Marketplace address must be plain `https://host`; address and key exist only as Edge Function secrets.
- Only the signed-in owner (verified with `is_owner()`) or the nightly secret can start a sync; one run at a time.
- Nightly runs also require `app_settings.nightly_sync_enabled = true` (it is false by default).
- The copy is readable by active Studio members only; nobody but the Edge Function can write it.

## BLOCKER before the first sync
Pending item F6 (MARKETPLACE_INTEGRATION.md): you have not yet confirmed that the live marketplace still loads
products. Do not run a sync until you have.

## Owner steps (in order; Claude does none of these)
1. Review `0003_catalogue.sql`, apply it in the Studio SQL editor, then run `review/0003_catalogue.policy-tests.sql`
   (expect "ALL CATALOGUE TESTS PASSED").
2. Close item F6.
3. In the Studio project, set Edge Function secrets: MARKETPLACE_URL, MARKETPLACE_PUBLISHABLE_KEY, NIGHTLY_SYNC_SECRET.
4. Deploy `sync-catalogue` yourself (this repository's rules forbid Claude from deploying).
5. Open the Catalogue page and press "Sync now" as the owner (or call the function yourself), then check `select * from sync_runs order by started_at desc limit 5;`.

## Tested
- Allowlist and paging logic: 12 Vitest tests with a mocked fetch (paging, failure of any page, unexpected column,
  unsafe address, runaway paging, GET/no-redirect).
- 0003 applied, policy-tested and rolled back on a throwaway local Postgres 16 with stubbed `auth`/`storage` schemas
  (not a real Supabase project, so Supabase-specific behaviour such as the real `auth.uid()` is not covered).

## NOT tested
- The Edge Function itself (Deno is not installed here, so `index.ts` has never been run or type-checked).
- Any request to the real marketplace, and the real service-role/RPC permissions on Supabase.
- The new Catalogue page ("Sync now" for the owner, last 10 runs for members) builds and type-checks but has not been looked at in a browser or run against a real Studio project. Its Amharic text is DRAFT.
- There is still no nightly scheduler (nothing calls the function on a timetable yet).
