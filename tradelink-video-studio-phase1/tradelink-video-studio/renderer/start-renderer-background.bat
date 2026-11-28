@echo off
rem Runs the renderer without a visible window and writes everything it says to renderer.log.
rem Started by the Windows start-up shortcut that install-autostart.bat creates.
cd /d "%~dp0"
:loop
if exist renderer.log for %%A in (renderer.log) do if %%~zA GTR 2000000 move /y renderer.log renderer.old.log >nul
echo %date% %time%  Starting the renderer>>renderer.log
node src\main.js >>renderer.log 2>&1
echo %date% %time%  The renderer stopped. Restarting in 30 seconds.>>renderer.log
timeout /t 30 /nobreak >nul
goto loop
