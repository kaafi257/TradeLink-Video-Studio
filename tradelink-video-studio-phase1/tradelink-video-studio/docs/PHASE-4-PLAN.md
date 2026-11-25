# Phase 4 plan: AI Video Automation (for approval, nothing implemented)

Branch `phase-4-ai-automation` exists locally from main (b4b6e3f). No code changed.

## 1. What I inspected
- **Web app** (React/TS/Vite, plain CSS): catalogue pages, Videos list, New video wizard, scene editor with export panel, EN/AM dictionaries (AM flagged DRAFT). Only dependencies: react, react-router-dom, supabase-js.
- **Database** (migrations 0001-0005): roles owner/editor/viewer, catalogue tables (products have name, description, brand, unit, package size, MOQ, prices, stock status, approved image), `video_projects` / `video_scenes` / `render_jobs` / `video_status_history`, `renderer_accounts`, status machine enforced by triggers, queue/cancel/renderer functions. Languages are constrained to `en`,`am`; styles to `premium`,`dynamic`,`minimal`.
- **Renderer** (`renderer/`): local Node + FFmpeg on your Windows PC, signs in as a low-privilege account, claims jobs, renders, ffprobe-verifies, uploads. Only it can set Ready to post.
- **Scene generator** (`src/lib/scenes.ts`): builds scenes only from approved catalogue data; wholesale shows MOQ, never an invented price.
- **Auth/API**: Supabase Auth with MFA for owner, RLS on every table, no custom API server, **no Edge Functions exist yet** (`supabase/functions` is absent), CSP only allows connections to your Supabase project.
- Marketplace: untouched, stays untouched.

## 2. The decision that shapes everything: AI provider vs "$0 forever"
Your rules: strict $0, ask before any new account or network service, secrets never in the repo. Three ways to get AI text, all $0:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Local AI on your Windows PC** (Ollama, free, open models) | The renderer program also claims "copy jobs" and asks a model running on your PC | $0 forever, private, no API key, no Edge Function, no deploy, same security model as Phase 3 | Needs a decent PC (8 GB+ RAM); small models write weak Amharic and Somali |
| **B. Free-tier hosted model** (e.g. Gemini/Groq free tiers) via a Supabase Edge Function | Edge Function holds the API key | Better quality, works from phone/browser | New account + secret + Edge Function deploy; free limits and terms can change or end; catalogue text leaves your system |
| **C. Rules and templates only** (no model) | Deterministic copy from approved data | $0, predictable, no invention | Not really "AI"; repetitive wording |

**Recommendation: build a provider-agnostic design, ship A + C first.** Rule-based copy is always available as the fallback; the local model improves wording when your PC has it. Option B stays a later add-on only if you approve the account and key. Every provider sits behind one interface so switching needs no UI change.

**Truthfulness guard (applies to every provider):** AI may only rephrase and organise approved catalogue facts. A "claims guard" rejects any generated text that contains a number, price, percentage, stock claim, certification, superlative ("best", "cheapest", "#1") or contact detail that is not in the approved data. Rejected text is shown as a warning, never saved silently.

## 3. Features, mapped to what exists
| Feature | Reuse | New |
|---|---|---|
| 1. AI Product-to-Video | catalogue, wizard, `generateScenes`, scene editor, queue, renderer | "AI draft" step: copy for each scene, caption, hashtags |
| 2. Script and marketing copy | scene `headline/body`, project `caption/hashtags` fields, `source` tracking | copy generator (rules + optional local model), claims guard, "AI" source tag, regenerate per scene |
| 3. English, Somali, Amharic | dictionaries, `Lang`, Noto/DejaVu fonts, DRAFT flag | `so` language in DB + app + generator; Somali dictionary (DRAFT); Somali labels in scenes. Latin script so current fonts already render it |
| 4. Professional templates | `STYLES`, `layoutScene`, animations | Template = style + scene recipe + pacing + animation set. Code-defined (no table), stored as `template_id` on the project. Planned set: 6 templates, e.g. Clean Product, Bold Sale, Wholesale Offer, Supplier Spotlight, Campaign Banner, Story Quick |
| 5. One-click generation | wizard defaults, `queue_video` | "Quick create" button: pick product → template, language, duration, CTA defaults → scenes + copy + quality check → draft. Queueing stays one explicit confirmation |
| 6. Quality Assistant | `renderer_complete_job` verification, `timeMatches` | pre-render checker (see 5.3) and post-render checker |

## 4. New components
**Web app:** `src/lib/copy.ts` (generator interface, rule-based provider), `src/lib/claimsGuard.ts`, `src/lib/templates.ts`, `src/lib/quality.ts`, `src/pages/videos/QuickCreate.tsx`, a "Quality check" panel and "Improve copy" buttons inside the existing editor (no redesign), `so` dictionary.
**Renderer:** `renderer/src/copyjob.js` (claims copy jobs, calls local Ollama on `localhost` only, returns text), template-aware layout in `layout.js`, optional frame-sampling checks (black frames, text overflow) after render.
**Docs:** AI setup guide (optional Ollama install), Phase 4 report.

### 5.3 Quality Assistant checks
Before rendering (instant, in the app): scene total matches duration, every image approved, text fits (line count and length for each language), CTA present and well formed, wholesale has MOQ, no price shown for wholesale, caption length ≤ 2200 and ≤ 30 hashtags, claims guard clean, AM/SO DRAFT reminder, product price/stock still equal to what scenes show (catches stale edits).
After rendering (renderer): existing ffprobe facts, plus black or frozen frame detection, loudness only if audio exists, cover not blank.
Output: a pass/warn/fail list. **Fail** blocks queueing; **warn** lets you proceed.

## 5. Database changes (migration `0006_ai_automation.sql`, written for your review, never applied by me)
- `video_projects.language` check extended to `en`, `am`, `so`; add `template_id text`, `copy_source text` (`manual`/`rules`/`local_ai`), `quality_report jsonb`, `quality_checked_at`.
- New `copy_jobs` table (project, scene scope, language, status, result jsonb, error, attempt), same pattern as `render_jobs`: editors create via a function, **only the registered renderer account** claims and completes (functions `copy_claim_job`, `copy_complete_job`, `copy_fail_job`), RLS read for members, no direct writes.
- `queue_video` extended: refuses when the stored quality report has a fail, and keeps all existing checks. `scene_type`/animation lists unchanged.
- Policy tests (B-series style) and rollback file, same as 0004/0005. Re-runnable-safe notes for the SQL Editor.

## 6. API and security
- No new server, no new public endpoint, no service-role key anywhere. Browser talks only to your Supabase (CSP unchanged for option A and C).
- Local model reached only at `http://localhost` from the renderer; the prompt contains approved catalogue facts only, never emails, keys or other users' data.
- Generated text is untrusted: length-limited, control characters stripped, claims guard applied in the app and again by a DB check on length and tags; never executed or rendered as HTML (React text only).
- Prompt injection: catalogue fields are passed as quoted data; output is validated against a strict JSON shape; anything off-shape is discarded.
- Roles: viewers read only; editors/owners create copy jobs; only the renderer account can complete them.
- Option B (only if approved): API key stored as an Edge Function secret you set yourself, per-user rate limit table, cost cap by free-tier limit, request logging without content.
- Still no auto-posting to TikTok; Amharic and Somali stay marked DRAFT until a native speaker approves.

## 7. Implementation stages (each: branch commits, tests, your "merge it")
1. **Foundations:** migration 0006 + policy tests + rollback; `so` language; template definitions. (You apply SQL, same as before.)
2. **Copy engine:** rule-based generator for EN/AM/SO, claims guard, tests.
3. **Templates + one-click:** template-aware layout in the renderer, `QuickCreate` page, defaults.
4. **Quality Assistant:** pre-render checker in the editor, queue gate, post-render frame checks.
5. **Local AI provider (optional):** copy jobs in the renderer, Ollama bridge, "Improve copy" buttons, fallback to rules when unavailable.
6. **Hardening and report:** end-to-end tests, Windows guide update, Phase 4 report.

## 8. Testing strategy
Unit tests for generator, claims guard (including attempts to sneak in prices/claims), templates, quality rules, dictionaries (every key in en/am/so). Local Postgres policy tests for 0006. Playwright UI tests on the mock backend (quick create, quality gate, copy regeneration, Somali/Amharic screens). Renderer tests with real FFmpeg for every template and language, plus a fake model server for copy jobs (valid, malformed, malicious output). Live checks by you: apply 0006, run the policy test SQL, one real video per language.

## 9. Risks and dependencies
- **AI quality in Amharic and Somali** is the biggest risk; small local models are poor at both. Mitigation: rule-based templates are the default, AI output is optional, every AM/SO text is DRAFT and needs a native-speaker review. I cannot judge Somali or Amharic correctness myself.
- **Your PC:** local AI needs RAM and disk space; without it, features 1-6 still work via rules.
- **Hosted free tiers** may change or end, so they are not a foundation.
- **Hallucinated claims** are the main legal/brand risk, hence the claims guard and the human approval before queueing.
- **Fonts:** brand fonts still missing; Somali uses Latin glyphs so it is fine with current fonts.
- **Missing data:** YOONIKK Men has no price/MOQ, so wholesale demos cannot run until you add them.
- **Scope creep:** "AI quality assistant" here means rule-based checks plus frame analysis, not a model judging taste.

## 10. Decisions I need from you
1. AI provider: **A+C** (recommended), or also B?
2. Somali: confirm adding `so`, with DRAFT status until reviewed, and who reviews Somali and Amharic.
3. Templates: OK with the 6 listed, or a different set?
4. One-click: should it stop at Draft (recommended) or also queue when all checks pass?
5. May I add no new npm dependencies (planned: none)? Ollama would be an optional separate install on your PC.
