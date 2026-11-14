#!/bin/bash
# FlameAtlas — start the app (API + UI) on http://127.0.0.1:8000 and open it.
# Rebuilds the front-end automatically when its sources or packages changed.
trap 'echo; read -r -p "Appuie sur Entrée pour fermer cette fenêtre…" _' EXIT
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -x .venv/bin/uvicorn ] || { echo "Lance d'abord setup.command."; exit 1; }
if [ ! -d frontend/node_modules/three ] || [ frontend/package.json -nt frontend/node_modules/.package-lock.json ]; then
  echo "==> Installation des paquets du frontend (une seule fois)…"
  (cd frontend && npm install --no-fund --no-audit) || { echo "ARRÊT: npm install a échoué"; exit 1; }
fi
if [ backend/requirements.txt -nt .venv/.req-stamp ]; then
  echo "==> Mise à jour des paquets Python…"
  .venv/bin/pip install -q -r backend/requirements.txt && touch .venv/.req-stamp
fi
if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src frontend/public frontend/index.html -newer frontend/dist/index.html -print -quit)" ]; then
  echo "==> Build du frontend…"
  (cd frontend && npm run build) || { echo "ARRÊT: build échoué"; exit 1; }
fi
( sleep 3 && open "http://127.0.0.1:8000" ) &
echo "FlameAtlas tourne sur http://127.0.0.1:8000  (docs API : /docs). Ferme cette fenêtre ou Ctrl+C pour arrêter."
cd backend && ../.venv/bin/uvicorn flameatlas.api.main:app --host 127.0.0.1 --port 8000
