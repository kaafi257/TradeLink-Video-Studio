@echo off
rem Stops the background renderer and removes the start-up shortcut. Your videos and settings are not touched.
set "LAUNCHER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TradeLink Renderer.vbs"
if exist "%LAUNCHER%" del /f /q "%LAUNCHER%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*start-renderer-background.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*src\main.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo.
echo Auto-start removed and the background renderer stopped. You can still run start-renderer.bat by hand.
pause
