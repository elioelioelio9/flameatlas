#!/bin/bash
# FlameAtlas — publish the local Git repository to a new PRIVATE GitHub repo.
trap 'echo; read -r -p "Appuie sur Entrée pour fermer cette fenêtre…" _' EXIT
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v gh >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "==> Installation de GitHub CLI (brew install gh)…"
    brew install gh || { echo "ARRÊT: brew install gh a échoué."; exit 1; }
  else
    echo "GitHub CLI n'est pas installé et Homebrew non plus."
    echo "Télécharge l'installeur macOS sur https://cli.github.com puis relance ce script."
    open "https://cli.github.com"
    exit 1
  fi
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "==> Connexion à GitHub : un code va s'afficher ; ton navigateur s'ouvre, colle le code et valide."
  gh auth login --hostname github.com --git-protocol https --web || { echo "ARRÊT: connexion annulée."; exit 1; }
fi
gh auth setup-git >/dev/null 2>&1

LOGIN="$(gh api user --jq .login)"
git config user.email >/dev/null 2>&1 && [ "$(git config user.email)" != "flameatlas@users.noreply.github.com" ] || \
  git config user.email "$(gh api user --jq .id)+${LOGIN}@users.noreply.github.com"
# never publish secrets
git rm --cached -q .env 2>/dev/null
git add -A
if git diff --cached --name-only | grep -qE '(^|/)\.env$'; then echo "ARRÊT: .env serait publié."; exit 1; fi
git commit -q -m "Fire lab v3 (4 habitats, analysis tools), knowledge engine (graph, research, Obsidian), ORBITAL art direction" 2>/dev/null || true

if git remote get-url origin >/dev/null 2>&1; then
  git push -u origin main
else
  gh repo create flameatlas --private --source . --remote origin --push \
    --description "FlameAtlas — fire-safety evidence from NASA microgravity combustion data (NASA Space Apps 2026)"
fi
echo
read -r -p "Pseudo GitHub de ton coéquipier à inviter (Entrée pour passer) : " MATE
if [ -n "$MATE" ]; then
  gh api -X PUT "repos/${LOGIN}/flameatlas/collaborators/${MATE}" -f permission=push >/dev/null && \
    echo "Invitation envoyée à ${MATE} (il doit l'accepter sur github.com ou par e-mail)." || echo "Invitation impossible (pseudo correct ?)."
fi
echo "Dépôt : https://github.com/${LOGIN}/flameatlas  (privé — passe-le en public avant la soumission)"
gh repo view --web >/dev/null 2>&1
