@echo off
REM FlameAtlas - one-click setup for Windows (double-click in Explorer).
setlocal
cd /d "%~dp0"
echo FlameAtlas setup - dossier: %CD%

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY ( where python >nul 2>nul && set "PY=python" )
if not defined PY ( echo ARRET: Python 3.10+ introuvable. Installe-le depuis https://www.python.org/downloads/ en cochant "Add python.exe to PATH", puis relance. & goto :end )
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" || ( echo ARRET: il faut Python 3.10 ou plus recent. & goto :end )
%PY% --version
where node >nul 2>nul || ( echo ARRET: Node.js introuvable. Installe la version LTS depuis https://nodejs.org puis relance. & goto :end )
node --version

echo.
echo ==^> Environnement Python + paquets backend
if not exist .venv ( %PY% -m venv .venv || ( echo ARRET: creation de .venv impossible & goto :end ) )
.venv\Scripts\python.exe -m pip install --upgrade pip -q
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt || ( echo ARRET: pip install a echoue & goto :end )

echo.
echo ==^> Construction de la base de donnees (corpus NASA PSI)
pushd backend
..\.venv\Scripts\python.exe -m flameatlas.etl.build || ( popd & echo ARRET: construction de la base echouee & goto :end )
echo.
echo ==^> Tests
..\.venv\Scripts\python.exe -m pytest -q || ( popd & echo ARRET: des tests echouent & goto :end )
popd

echo.
echo ==^> Frontend: paquets + build
pushd frontend
call npm install --no-fund --no-audit || ( popd & echo ARRET: npm install a echoue & goto :end )
call npm run build || ( popd & echo ARRET: build frontend echoue & goto :end )
popd

if not exist .env copy .env.example .env >nul
type nul > .venv\.req-stamp
echo.
echo OK - installation terminee. Lance start.bat pour ouvrir FlameAtlas.
echo (Optionnel: mets ta cle ANTHROPIC_API_KEY dans le fichier .env pour des reponses redigees.)
:end
echo.
pause
