# Windows renderer: install and run guide

The renderer is a small program that runs on **your own Windows computer**. It picks up videos you queued in the
Studio, makes the MP4 with FFmpeg, checks it, and uploads it. Everything it uses is free (Node.js, FFmpeg). It never
posts anything to TikTok: you download the finished video and post it yourself.

## What you need
- Windows 10 or 11, and an internet connection while it runs.
- **Node.js 22 LTS** (free): https://nodejs.org . Install with the default options.
- **FFmpeg 6.0 or newer, full build** (free): for example the "release full" zip from https://www.gyan.dev/ffmpeg/builds/ .
  Unzip it to `C:\ffmpeg`. You should then have `C:\ffmpeg\bin\ffmpeg.exe` and `C:\ffmpeg\bin\ffprobe.exe`.
  Either add `C:\ffmpeg\bin` to your PATH, or put the two full paths into `.env` (step 4).
- The `renderer` folder from this repository (GitHub → Code → Download ZIP, then copy just the `renderer` folder).

## 1. Create the renderer login (once, in the Studio's own Supabase project)
1. Supabase → **Authentication → Users → Add user → Create new user**. Use an email you control and a long random
   password. Tick "Auto Confirm User". This login is only for the renderer, never for people.
2. Leave its profile **inactive** (that is the default). It must not be able to read your catalogue.
3. SQL Editor → run (replace the email with the one you used):
   ```sql
   insert into public.renderer_accounts (user_id, label)
   select id, 'Windows renderer' from auth.users where email = 'renderer@example.com';
   ```
   It should say "Success. 1 row". The renderer can now claim jobs, read the pictures a job needs, and upload videos.
   It cannot read the catalogue, edit anything, or see other people's data.

## 2. Install
Open **PowerShell** in the `renderer` folder (Shift + right-click inside the folder → "Open PowerShell window here"):
```
npm install
```

## 3. Settings
Copy `.env.example` to `.env` (same folder) and fill in:
- `STUDIO_SUPABASE_URL`: Supabase → Project Settings → API → Project URL (the **Studio** project).
- `STUDIO_SUPABASE_PUBLISHABLE_KEY`: the **publishable / anon** key. **Never** paste a `service_role` or `secret` key:
  the renderer refuses to start if it finds one.
- `RENDERER_EMAIL` and `RENDERER_PASSWORD`: the login from step 1.
- `FFMPEG_PATH` / `FFPROBE_PATH`: only if ffmpeg is not on your PATH, e.g. `C:\ffmpeg\bin\ffmpeg.exe`.

`.env` stays on this computer. It is ignored by git and must never be shared, committed or sent in chat.

## 4. Check it works
```
npm run check
```
Expected: FFmpeg and ffprobe versions, "Signed in as the renderer account.", then "Check passed."

## 5. Run it
- Double-click **`start-renderer.bat`** (or run `npm start`) and leave the window open. It checks for queued videos
  every 15 seconds and renders one at a time. Press Ctrl+C to stop after the current video.
- `npm run once` renders one queued video and exits (useful for a first test).
- A 20-second video takes roughly one to three minutes on an ordinary PC.

To start it automatically: Windows Task Scheduler → Create Basic Task → "When I log on" → Start a program →
`C:\...\renderer\start-renderer.bat`. No administrator rights needed.

## What happens to a video
1. In the Studio you create a video, check its scenes and press **Queue for rendering** (status *Queued*).
2. The renderer claims it (*Rendering*), downloads the approved images, and makes a 1080×1920, 30 fps, H.264
   (yuv420p) MP4 with FFmpeg.
3. It measures the file with ffprobe. Only if the size, codec, pixel format, frame rate and length are right does it
   upload the MP4 and a cover picture and report back. The database repeats the same check, and only then sets
   **Ready to post**. Nothing else can set that status.
4. If something goes wrong it retries (up to 3 attempts), then shows **Failed** with a plain reason in the Studio.
   You can fix the cause and queue it again.
5. You download the MP4, cover and caption from the Studio and post to TikTok yourself.

## Troubleshooting
| Message | Meaning and fix |
|---|---|
| `Settings file not found` | Create `.env` from `.env.example`. |
| `holds a secret/service-role key` | You pasted the wrong key. Use the publishable (anon) key. |
| `Renderer sign-in failed` | Wrong email or password, or the user was not confirmed. |
| `This login is not registered as a renderer` | Run the SQL in step 1.3 for this email. |
| `ffmpeg was not found` | Install FFmpeg and add it to PATH, or set `FFMPEG_PATH`. |
| `Could not download the image …` | The picture was deleted from the catalogue after queueing. Restore it and queue again. |
| `Verification failed: …` | The finished file did not meet the format check. Send me the exact message. |
| A video stays *Rendering* for over 30 minutes | The PC stopped mid-job. Start the renderer again; the job is re-offered automatically. |

## Limits and honest notes
- Fonts: Latin text uses DejaVu Sans Bold and Amharic uses Noto Sans Ethiopic Bold (both free, licences in `renderer/fonts`).
  The brand fonts (Public Sans, Bricolage Grotesque, Archivo) are not in the repository yet.
- Videos have no sound for now (no music is bundled). TikTok lets you add sound when you post.
- **Amharic wording is DRAFT** until a native speaker approves it. Check every Amharic video before posting.
- The renderer was tested here with real FFmpeg 6.1 and a simulated Supabase. It has not yet run against your live project:
  run `npm run check`, then `npm run once` with one queued video as the first real test.

## Optional: local AI wording
Off by default. See "Turning the local AI on" in `docs/PHASE-4.md`. It only talks to Ollama on this same computer, and every suggestion is checked by the database before anyone can apply it.

## Optional: your logo and your own sound (Phase 5)
Both are off until you set them in `renderer\.env`. The renderer never downloads or picks any picture or music for you.
- `BRAND_LOGO=C:\brand\logo.png` : your own logo (.png, .jpg or .webp). It replaces the plain "TradeLink" text mark in the top-left corner and is scaled to fit, never stretched.
- `AUDIO_FILE=C:\brand\music.mp3` : your own sound (.mp3, .m4a, .aac, .wav or .ogg). It is looped if short, cut to the video length, faded in and out, and written as AAC. `AUDIO_VOLUME=0.5` sets the level (0 to 1).
- Only use a logo and sound you own or have the right to use. Copyright for the sound is your responsibility; TikTok may mute or reject music it does not recognise as licensed for business accounts.
- Run `npm run check`. It reports "Logo: ..." and "Sound: ..." or "not set (optional)". Leave both lines empty to keep videos silent with the text mark, exactly as before.
- Latin text now uses the brand font Bricolage Grotesque (SIL Open Font License, in `fonts\`). Amharic keeps Noto Sans Ethiopic. If the brand font file is missing, the renderer falls back to the old font.

## Closing frame (Phase 5 Stage A)
- On by default. The last second of every video fades to the brand blue and shows your `BRAND_LOGO` (or the TradeLink name) in the middle. It sits on top of the last scene, so the video length does not change. It is skipped when the last scene is shorter than 3 seconds, so the contact line stays readable.
- `CLOSING_FRAME=off` in `.env` turns it off.
