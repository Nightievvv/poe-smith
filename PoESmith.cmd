@echo off
rem PoESmith launcher: double-click to start. Does not need npm in PATH.
cd /d "%~dp0app"
set "NODEDIR=C:\Program Files\nodejs"
set "PATH=%NODEDIR%;%PATH%"
if not exist "node_modules" (
  echo Installing dependencies...
  call "%NODEDIR%\npm.cmd" install || goto :err
)
call "%NODEDIR%\npm.cmd" run build >nul 2>&1 || goto :err
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0

:err
echo Build failed. Open PowerShell in "%~dp0app" and run: npm run build
pause
