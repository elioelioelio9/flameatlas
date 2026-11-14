@echo off
REM Fire Lab - start the app (API + UI) on http://127.0.0.1:8000 and open it.
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\uvicorn.exe ( echo Lance d'abord setup.bat. & pause & exit /b 1 )
REM fetch the latest version from GitHub (ignored if offline or if there are local edits)
where git >nul 2>&1 && ( echo ==^> Mise a jour depuis GitHub... & git pull --ff-only )
REM always rebuild the front-end so the browser shows the current code
pushd frontend
if not exist node_modules\three call npm install --no-fund --no-audit
echo ==^> Build du frontend...
call npm run build || ( popd & echo ARRET: build echoue & pause & exit /b 1 )
popd
start "" "http://127.0.0.1:8000"
echo Fire Lab tourne sur http://127.0.0.1:8000  (docs API: /docs). Ferme cette fenetre pour arreter.
cd backend
..\.venv\Scripts\uvicorn.exe flameatlas.api.main:app --host 127.0.0.1 --port 8000
pause
