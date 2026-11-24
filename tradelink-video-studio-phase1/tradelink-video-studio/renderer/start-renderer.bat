@echo off
rem Starts the TradeLink Video Studio renderer. Double-click this file; leave the window open.
cd /d "%~dp0"
:loop
node src\main.js
echo.
echo The renderer stopped. Restarting in 30 seconds. Close this window to stop it for good.
timeout /t 30 /nobreak >nul
goto loop
