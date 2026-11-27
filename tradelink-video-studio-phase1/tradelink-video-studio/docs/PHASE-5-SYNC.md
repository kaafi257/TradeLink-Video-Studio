# Phase 5 Stage 3 — Marketplace sync (owner steps)

**What it does.** Catalogue → Sync → **Sync now** (owner only) copies categories, suppliers, products and product pictures from the TradeLink marketplace's PUBLIC views into this Studio. It only reads. Nothing is sent to or changed on TradeLink. Cost: $0.

**Rules it follows**
- New items are added. Anything already typed or edited in the Studio is never overwritten (only EMPTY fields are filled). Nothing is deleted.
- Copied pictures are approved for video automatically. A picture you remove may come back on the next sync.
- Products typed by hand are not matched by name, so a hand-typed copy of a marketplace product can appear twice. Categories and suppliers are matched by name.
- Campaigns are not synced. Deleted marketplace items are not removed here.
- If a sync fails, the previous copy stays. Pictures are copied within about 100 seconds; if some remain, the page says so — press Sync now again.
- Category pictures are copied only when the marketplace has them in an allowed public bucket.

**Do these steps yourself (Claude never does them)**
1. Confirm open item F6: the live TradeLink site still shows products.
2. Supabase (Studio project) → SQL Editor: run `supabase/migrations/0008_marketplace_sync.sql`.
3. Supabase → Edge Functions → Secrets: add `MARKETPLACE_URL` (the marketplace project URL) and `MARKETPLACE_PUBLISHABLE_KEY` (its publishable/anon key). Public values only — never a secret or service key.
4. Deploy the function `sync-marketplace` from `supabase/functions/sync-marketplace` (Supabase dashboard → Edge Functions, or the CLI).
5. Sign in as owner → Catalogue → Sync → **Sync now**. Repeat while pictures remain.

**Tests run by Claude (fake marketplace only):** SQL policy tests `supabase/review/0008_marketplace_sync.policy-tests.sql`, 16 function tests, and the browser checks. The real marketplace was never contacted, so the first real sync is untested.

**Undo:** `supabase/review/0008_marketplace_sync.rollback.sql`.
