#!/bin/bash
# Fire Lab video: records the voice-over with the Mac voice and adds it to the video.
cd "$(dirname "$0")" || exit 1
VOICE="${1:-Daniel}"   # other English voices: Samantha, Alex, Karen (System Settings > Accessibility > Spoken Content)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p voix
say -v "$VOICE" -r 185 -o voix/l0.aiff "An astronaut lands on Mars. If a fire starts, how will it behave?"
say -v "$VOICE" -r 185 -o voix/l1.aiff "Ask Fire Lab. It searches NASA's fire experiments and scores each one out of a hundred, so you only read what matters."
say -v "$VOICE" -r 185 -o voix/l2.aiff "Then it rebuilds your base in 3-D."
say -v "$VOICE" -r 185 -o voix/l3.aiff "Add equipment, open the walls, place the vents."
say -v "$VOICE" -r 185 -o voix/l4.aiff "Ignite. Airflow, smoke and oxygen are computed live at Mars gravity, down to the second the alarm goes off."
say -v "$VOICE" -r 185 -o voix/l5.aiff "Fire Lab: NASA data, turned into fire safety, on Mars and on Earth."
if command -v ffmpeg >/dev/null; then
  ffmpeg -y -i fire_lab_30s_sans_voix.mp4 -i voix/l0.aiff -i voix/l1.aiff -i voix/l2.aiff -i voix/l3.aiff -i voix/l4.aiff -i voix/l5.aiff -filter_complex "[1:a]adelay=300|300[a0];[2:a]adelay=4700|4700[a1];[3:a]adelay=11500|11500[a2];[4:a]adelay=14100|14100[a3];[5:a]adelay=17900|17900[a4];[6:a]adelay=26000|26000[a5];[a0][a1][a2][a3][a4][a5]amix=inputs=6:normalize=0[v]" -map 0:v -map "[v]" -c:v copy -c:a aac -b:a 192k -shortest fire_lab_30s_avec_voix.mp4 && echo "OK: fire_lab_30s_avec_voix.mp4"
else
  echo "ffmpeg absent: les phrases sont dans le dossier voix/ (l0 à l5). Glisse-les dans iMovie aux temps du fichier voix_off.txt."
fi
read -r -p "Entrée pour fermer…" _
