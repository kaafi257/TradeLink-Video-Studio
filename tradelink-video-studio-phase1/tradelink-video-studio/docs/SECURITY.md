# Security notes

## Separation from the marketplace

The Studio is a separate website with its own Supabase project, Vercel project and GitHub
repository. It shares no accounts, sessions or permissions with the TradeLink marketplace and adds
nothing to it. In Phase 1 the Studio makes no request to the marketplace at all.

## Marketplace read-only integration (from Phase 2)

**The marketplace anon (publishable) key does not itself guarantee database-level read-only
access.** That key can also call some public database functions on the marketplace (for example
quote requests, newsletter sign-up, coupon and event-tracking functions). Read-only behaviour is
enforced by the Studio's own code, tests and review, not by the key: HTTP GET only, to ten fixed
view paths, with explicit column lists, no function calls, no base tables, no discovery, and
no access to the supplier-documents bucket.

**The marketplace repository migrations are incomplete compared with its live database.** The live
database has tables not present in those migrations (for example nine `marketplace_*` tables), the
repository lacks migration 0014 and contains two files numbered 0016. The Studio therefore relies
only on the columns verified against the live database (see MARKETPLACE_INTEGRATION.md).

## Secrets

- Public values only in `VITE_` variables (the Studio project address and publishable key).
- The Studio refuses to start with a secret or service-role key, or with the marketplace address
  (`src/lib/config.ts`).
- `npm run guard` fails on committed secrets, committed `.env` files, and marketplace references.
- The marketplace service-role key is never requested, stored or used anywhere.

## Access

Invite-only: public sign-up is disabled in the Studio Supabase project. New users start inactive
and see nothing until the owner activates them. The owner must use an authenticator app. Row-level
security is on for every table; the anon role has no privileges. Phase 1 enforces the
authenticator requirement in the interface only; database-level enforcement is a candidate for
Phase 7 hardening.

## Database changes

Migrations are never applied automatically. CI holds no database credentials.
