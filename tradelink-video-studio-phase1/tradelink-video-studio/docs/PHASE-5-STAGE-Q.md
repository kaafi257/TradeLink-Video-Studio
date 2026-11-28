# Phase 5 Stage Q — video quality and a more polished look

**Renderer (free FFmpeg only; restart the renderer after updating)**
- Scenes join with slide and fade transitions. Scenes are drawn slightly longer by the overlap, so the total length is unchanged (an unanimated scene gets a one-frame cut; clips under 1.5 s fall back to plain cuts).
- Zoom and pan use smooth ease-in/ease-out. Photos get a light contrast, saturation and sharpness lift.
- Text-only scenes (price, minimum order, contact) sit on a blurred, brand-blue copy of the product picture instead of flat navy. The Minimal style keeps its light background.
- Price scene is a gold sale tag; when there is a sale the old price is shown above it with a line through it. Both numbers come from the approved catalogue.
- Thin gold progress bar along the top; closing logo frame from Stage A unchanged.
- Encoding: `RENDER_QUALITY=high` (default; CRF 17, preset medium, High profile) or `fast` (CRF 20, veryfast). Needs an FFmpeg with the xfade, zoompan, drawtext, gblur, unsharp, vignette and blackdetect filters; `npm run check` now tells you if one is missing.

**App**
- Video page: a Storyboard strip (one small card per scene with picture, wording and length).
- Loading placeholders (shimmering bars) instead of plain "Loading…" on lists and the video page.

**Not done (honest):** cover-frame choice (needs a new database column and migration, so it is left for a later stage); a built-in moving preview of the finished video (the Storyboard is a still preview; the real video is the rendered file).
**Not tested:** your Windows FFmpeg build and render time on your PC, how it looks inside TikTok, Amharic text in the new price tag layout on real photos.
