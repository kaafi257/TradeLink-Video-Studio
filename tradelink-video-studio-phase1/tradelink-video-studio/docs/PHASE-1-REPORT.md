# Phase 1 report (honest status)

## What was written

App (login, owner authenticator enrolment and challenge, dashboard shell, settings, English and
draft Amharic text, role guard), styles using the verified TradeLink brand values, Vercel
configuration with security headers, repository guard script, CI workflow, two migrations with
verification, rollback and policy-test files, and the security, environment and integration notes.

## What was verified in the authoring environment

- TypeScript syntax check of all source files (module resolution disabled, so only syntax and
  basic type errors that do not depend on installed packages were checked).
- Unit tests for the configuration guard, role helpers and translation parity, run against a small
  stand-in for the Vitest API (not Vitest itself).
- `scripts/guard.mjs` run against the project.

## NOT verified (the authoring environment has no internet, no Postgres and no browser run)

- `npm install`, and that the pinned dependency ranges install together without conflicts.
- ESLint, the real Vitest run, the Vite build, and how the screens look and behave.
- Supabase authenticator (TOTP) calls against the real service.
- All SQL: the migrations, verification queries and policy tests have never been run.
- The CI workflow and Vercel deployment. Action versions are not pinned to commit hashes yet.
- Self-hosted font files are not included (see public/fonts/README.md); Amharic rendering is
  therefore unchecked.

## Owner steps (in order)

1. Add the repository files, run `npm install`, commit the generated lock file.
2. Run `npm run guard`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; fix what fails.
3. Review `supabase/migrations/0001_foundation.sql` and `0002_storage.sql`. Apply 0001 then 0002 in the
   Studio project's SQL editor only, running each `review/*.verify.sql` afterwards.
4. Run `review/activate-owner.sql` (with your email) once.
5. Add the two Vercel variables and redeploy; sign in and enrol the authenticator app.
6. Run `review/0001_foundation.policy-tests.sql` (read its header first).
7. Add the font files and the logo files.

## Known limitations and decisions to confirm

- The owner authenticator requirement is enforced in the interface, not yet in database policies.
- The Amharic strings are my draft and need native review.
- Storage size limits in 0002 are proposals.
- The logo is not included; copy it from the marketplace brand folder (read-only copy).
