@echo off
rem Makes the renderer start by itself when you sign in to Windows, and starts it now. No administrator rights needed.
rem It runs hidden in the background and writes renderer.log in this folder. Undo with uninstall-autostart.bat.
cd /d "%~dp0"
if not exist ".env" (
  echo .env was not found in this folder. Finish the renderer setup first ^(see WINDOWS-RENDERER.md^), then run this again.
  pause
  exit /b 1
)
call npm run check
if errorlevel 1 (
  echo.
  echo The setup check failed, so auto-start was NOT installed. Fix the problem above and run this again.
  pause
  exit /b 1
)
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP%\TradeLink Renderer.vbs"
> "%LAUNCHER%" echo Set sh = CreateObject("WScript.Shell")
>> "%LAUNCHER%" echo sh.CurrentDirectory = "%~dp0"
>> "%LAUNCHER%" echo sh.Run """%~dp0start-renderer-background.bat""", 0, False
if not exist "%LAUNCHER%" (
  echo Could not create the start-up file in "%STARTUP%".
  pause
  exit /b 1
)
wscript //B "%LAUNCHER%"
echo.
echo Done. The renderer now starts by itself every time you sign in to Windows, and it is running now.
echo Queued videos will render without you doing anything. Progress is written to renderer.log in this folder.
echo To check on it, double-click renderer-status.bat. To turn it off, double-click uninstall-autostart.bat.
pause
