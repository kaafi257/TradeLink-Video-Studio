# Phase 1 brief: Foundation

Status: approved to start 21 November 2026 (Phase 0 security assessment approved; F6 live-site
check still pending and does not affect Phase 1). Read CLAUDE.md first. Its rules apply to everything here.

## Goal

A working, independent Studio shell: its own login page and dashboard, role-based security,
settings, TradeLink-branded interface in English and Amharic (draft), CI checks, and two
database migrations written for the owner's review. No marketplace contact. No video rendering yet.

## In scope

1. Repository structure, README, `.gitignore`, `.env.example`, licence files for fonts.
2. Vite + React + TypeScript app with routing:
   - `/login` sign-in (email + password), no sign-up link or route.
   - `/` dashboard shell (empty states only; no invented numbers or content).
   - `/settings` (fields below). Owner can edit; editor and viewer read only.
   - Authenticator-app (TOTP) enrolment and challenge screens for the owner.
   - Language switch English / Amharic. Amharic strings are flagged DRAFT.
3. Supabase client using only `VITE_STUDIO_SUPABASE_URL` and `VITE_STUDIO_SUPABASE_PUBLISHABLE_KEY`.
4. Route guard: a signed-in user without an active profile sees an access-denied page.
5. Migrations (files only, never applied by Claude Code): see below.
6. CI workflow (GitHub Actions): install, lint, type check, unit tests, build, secret scan
   (pinned action versions, minimal permissions). No deploy step, no database credentials.
7. Vercel configuration (`vercel.json`) with security headers (below).
8. Documentation: `docs/SECURITY.md` (must include the statement that the marketplace anon key does
   not itself guarantee database-level read-only access, and that the marketplace repository
   migrations are incomplete compared with its live database), `docs/MARKETPLACE_INTEGRATION.md`
   (verified view and column allowlist from the Phase 0 assessment), `docs/ENVIRONMENT.md`.

## Settings fields (all blank until the owner fills them; no defaults invented)

Brand name, site address, TikTok handle, default language (en or am), call-to-action channels
(WhatsApp, Telegram, phone, website). Time zone is fixed at Africa/Addis_Ababa and shown read-only.

## Migrations to write (owner reviews and applies by hand)

Each file ships with: purpose note, SQL, rollback script, SELECT-only verification queries,
and a policy-test list. Every table has row-level security on, no anonymous grants, explicit
grants to `authenticated` only, and any security-definer function has a fixed search path.

- `0001_foundation`
  - enum `app_role` (owner, editor, viewer)
  - `profiles` (id references auth.users, full_name, role, active default false, created_at);
    a trigger creates an INACTIVE viewer profile for each new auth user
  - helper functions: current role, is_owner, is_editor_or_owner (active profiles only)
  - `app_settings` (single row; fields above plus nightly_sync_enabled default false)
  - `audit_log` (append-only; owner can read; no update or delete for anyone)
- `0002_storage`
  - private buckets: source-images, renders, covers, music, with file size and type limits
    proposed in the file for the owner to review (do not treat them as final)
  - read policies for active members; no anonymous access; uploads and deletes stay
    service-role or owner only until later phases add narrower policies

## Security headers (`vercel.json`)

Content-Security-Policy limited to self plus the Studio Supabase address for connect, image and
media sources (https and wss), no external scripts or fonts, `frame-ancestors 'none'`;
X-Frame-Options DENY; X-Content-Type-Options nosniff; Referrer-Policy strict-origin-when-cross-origin;
Permissions-Policy denying camera, microphone and geolocation.

## Out of scope for Phase 1

Marketplace contact or sync, video rendering, templates, captions, hashtags, planner, performance
tracking, invitations screen for editors and viewers, nightly schedule, GitHub dispatch token.

## Acceptance checks (demonstrate and report each)

- Lint, type check, unit tests and build pass locally and in CI.
- No secret, key or token appears in the repository (secret scan clean).
- Sign-in works only for an active profile; sign-up route does not exist.
- Owner can open Settings and save; editor and viewer cannot save (UI and database both refuse).
- Language switch works; Amharic text renders correctly in Noto Sans Ethiopic and is marked DRAFT.
- Policy tests (run against a local throwaway database if Docker is available; otherwise written
  and listed for the owner to run after applying the migrations): anonymous sees nothing;
  inactive user sees nothing; viewer reads only; editor cannot change settings or roles;
  owner can change settings; nobody can update or delete audit_log rows.
- The app makes no request to any marketplace address.

## Owner tasks during Phase 1

- Review `0001` and `0002`, apply them by hand in the Studio Supabase SQL editor, run the
  verification queries, and report the results.
- Activate the owner profile once (a short SQL snippet will be provided with the migration).
- Add the two Vercel variables (Studio address and publishable key).
- Supply the logo files by copying them from the marketplace's brand folder (read-only copy).

## Demo script

1. Open the deployed Studio, sign in as owner, complete authenticator enrolment.
2. Switch language; open Settings; save a value; sign in as a second test user to show read-only access.
3. Show the CI run, the secret scan result, and the migration files with their verification queries.
