#!/bin/bash
# FlameAtlas — one-click setup for macOS (double-click in Finder).
echo "FlameAtlas setup — starting (bash $BASH_VERSION)"
trap 'echo; read -r -p "Appuie sur Entrée pour fermer cette fenêtre…" _' EXIT
HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
if [ -z "$HERE" ] || ! cd "$HERE"; then
  echo "ERREUR: impossible d'entrer dans le dossier du script ($0)."; exit 1
fi
echo "Dossier: $HERE"
LOG="$HERE/setup.log"
: > "$LOG" 2>/dev/null || { LOG="$HOME/flameatlas-setup.log"; : > "$LOG"; }
echo "Journal: $LOG"

step() { printf "\n==> %s\n" "$*" | tee -a "$LOG"; }
run()  { "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }
fail() { printf "\nARRÊT: %s\n" "$*" | tee -a "$LOG"; exit 1; }

step "Vérification des outils"
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then PY="$(command -v "$c")"; break; fi
done
[ -n "$PY" ] || fail "Python 3.10+ introuvable. Installe-le depuis https://www.python.org/downloads/ puis relance."
run "$PY" --version
command -v node >/dev/null 2>&1 || fail "Node.js introuvable. Installe la version LTS depuis https://nodejs.org puis relance."
run node --version
command -v git >/dev/null 2>&1 || fail "git introuvable. Lance: xcode-select --install"

step "Environnement Python + paquets backend"
[ -d .venv ] || run "$PY" -m venv .venv || fail "création de .venv impossible"
run .venv/bin/python -m pip install --upgrade pip -q
run .venv/bin/pip install -r backend/requirements.txt || fail "pip install a échoué (voir ci-dessus)"

step "Construction de la base de données (corpus NASA PSI)"
( cd backend && run ../.venv/bin/python -m flameatlas.etl.build ) || fail "construction de la base échouée"

step "Tests"
( cd backend && run ../.venv/bin/python -m pytest -q ) || fail "des tests échouent — envoie setup.log à Claude"

step "Frontend: paquets + build de production"
( cd frontend && run npm install --no-fund --no-audit && run npm run build ) || fail "build frontend échoué"

step "Dépôt Git"
[ -d .git ] || run git init -b main
git config user.name >/dev/null || git config user.name "Elio Miguel Aparicio"
if ! git config user.email >/dev/null; then
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    git config user.email "$(gh api user --jq .id)+$(gh api user --jq .login)@users.noreply.github.com"
  else
    git config user.email "flameatlas@users.noreply.github.com"
  fi
fi
git add -A
if ! git diff --cached --quiet; then
  run git commit -q -F - <<'MSG'
FlameAtlas: evidence engine for spacecraft fire safety (NASA Space Apps 2026)

- ETL of 26 NASA PSI combustion investigations (2,060 records, 7,688 measurements)
  into SQLite (investigation / test / measurement, FTS5), with quality flags
- Need-based explainable ranking, hybrid search (BM25 + TF-IDF), coverage and
  gap analysis vs habitat atmospheres, comparison, traceable ZIP export
- Grounded Q&A assistant with enforced citations and offline fallback
- FastAPI backend + React/TypeScript/d3 frontend, pytest suite

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016wtaNJGupQxDy2YKeUsWs5
MSG
  run git log --oneline -1
else
  echo "Rien de nouveau à committer."
fi

step "GitHub"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if git remote get-url origin >/dev/null 2>&1; then
    run git push -u origin main
  else
    run gh repo create flameatlas --private --source . --remote origin --push \
      --description "FlameAtlas — fire-safety evidence from NASA microgravity combustion data (NASA Space Apps 2026)"
  fi
else
  echo "GitHub CLI absent ou non connecté : le repo n'a pas été poussé." | tee -a "$LOG"
  echo "  Option A : brew install gh && gh auth login, puis relance setup.command" | tee -a "$LOG"
  echo "  Option B : crée un repo vide 'flameatlas' sur github.com puis :" | tee -a "$LOG"
  echo "             git remote add origin https://github.com/<toi>/flameatlas.git && git push -u origin main" | tee -a "$LOG"
fi

printf "\nTERMINÉ. Double-clique start.command pour ouvrir FlameAtlas.\n" | tee -a "$LOG"
