@echo off
rem Shows whether the background renderer is running and the last lines of renderer.log.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*src\main.js*' }) { 'The renderer is RUNNING.' } else { 'The renderer is NOT running. Double-click install-autostart.bat or start-renderer.bat.' }"
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TradeLink Renderer.vbs" (echo Auto-start at sign-in: ON) else (echo Auto-start at sign-in: OFF)
echo.
echo Last lines of renderer.log:
if exist renderer.log (powershell -NoProfile -Command "Get-Content renderer.log -Tail 20") else (echo ^(no log yet^))
echo.
pause
