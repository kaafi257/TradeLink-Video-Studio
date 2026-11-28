# Phase 5 Stage C — automatic rendering

Four Windows scripts in the `renderer` folder (steps in `docs/WINDOWS-RENDERER.md`): `install-autostart.bat` (checks setup, adds a start-up launcher, starts the renderer hidden), `renderer-status.bat`, `uninstall-autostart.bat`, and `start-renderer-background.bat` (restarts after a stop, 2 MB rolling `renderer.log`). The renderer also writes an hourly "Watching the queue" line.

Safety: no administrator rights, no scheduled-task or registry changes (a launcher file in your own Startup folder only), same low-privilege renderer account, no service key, nothing is published. Uninstall removes only that launcher and stops the renderer.

Tests: file checks only (ASCII, CRLF line endings, order of steps, no admin-level commands, uninstall scope). **Not tested: the scripts have not been run on Windows** (this session cannot run Windows). Run `renderer-status.bat` after installing and tell Claude what it shows.
