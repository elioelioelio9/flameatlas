#!/bin/bash
# Fire Lab - rebuild the public website (no server) and publish it to GitHub Pages.
# Site: https://elioelioelio9.github.io/flameatlas/
trap 'echo; read -r -p "Appuie sur Entrée pour fermer cette fenêtre…" _' EXIT
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
set -e
echo "==> Build du site statique…"
(cd frontend && VITE_STATIC=1 npx vite build --outDir ../.site --emptyOutDir)
echo "==> Export des réponses (questions, données)…"
.venv/bin/python scripts/export_static.py .site/static-api
touch .site/.nojekyll
echo "==> Publication sur la branche gh-pages…"
REMOTE=$(git remote get-url origin)
cd .site && rm -rf .git && git init -q -b gh-pages && git add -A && git commit -qm "Fire Lab website" && git push -qf "$REMOTE" gh-pages
cd .. && rm -rf .site
echo "En ligne dans 1 à 2 minutes : https://elioelioelio9.github.io/flameatlas/"
