@echo off
REM Rebuild the web interface after pulling new code (git pull), then run start.bat.
cd /d "%~dp0frontend"
call npm install --no-fund --no-audit && call npm run build
echo.
pause
