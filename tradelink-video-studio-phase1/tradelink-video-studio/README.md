# TradeLink Video Studio

A separate website for making vertical (9:16) TikTok promotional videos from a copy of the
TradeLink catalogue. It has its own address, login, database, storage and deployment, and it is
independent of the TradeLink marketplace (no shared login, no pages or links on the marketplace,
repositories never merged). Videos are downloaded and posted to TikTok by hand.

Status: **Phase 1 (foundation)**. See `docs/PHASE-1-REPORT.md` for what exists and what is untested.

## Rules (short version; full rules in CLAUDE.md)

- Never touch the marketplace repository, database, authentication, deployment or settings.
- Never put a secret in this repository. Only public values use the `VITE_` prefix.
- Database migrations are reviewed files that the owner applies by hand. Nothing applies them
  automatically, and the Supabase GitHub integration stays disconnected.
- No invented business data. Amharic text is DRAFT until a native speaker approves it.

## Run locally

```
npm install
cp .env.example .env.local      # then fill in the two public Studio values
npm run dev
```

Checks: `npm run guard`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## Layout

- `src/` app code (login, owner authenticator setup, dashboard shell, settings, EN/AM text)
- `supabase/migrations/` SQL for owner review (never auto-applied)
- `supabase/review/` verification queries, rollback scripts, owner activation, policy tests
- `scripts/guard.mjs` fails the build on secrets or marketplace references
- `docs/` security, environment and marketplace-integration notes
