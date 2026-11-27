# Phase 5 Stage B — batch create

Videos → **Batch create**: tick up to 25 usable products (active, approved image), choose Product Showcase or Wholesale Offer and a template, then:
- **Create N drafts**: one Draft per product, to review one by one.
- **Create, check and queue N**: also checks each video, fixes safe wording problems once (same as Stage A) and queues it for rendering. A video that still has problems stays a Draft and is listed.

Rules
- Each video is built exactly like Quick create from approved catalogue data only. Language and contact come from Settings (the first saved contact; the Settings default language).
- A product that cannot make at least 3 scenes (too little data) is **skipped** and listed with the reason. Nothing is padded or invented.
- Products that already have a non-archived video are marked "already has a video"; "Select products without a video" ticks only the others, so you do not duplicate by accident.
- One failed product never stops the rest. Nothing is published automatically. No migration needed. Cost $0.

Tests: 4 unit tests (skip, queue outcomes, error containment, limit), browser checks for the page (usable products only, draft vs queue, skip reason, duplicate marker, phone layout).
Not tested: very large catalogues, real Supabase, Amharic on devices.
