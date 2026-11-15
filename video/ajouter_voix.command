#!/bin/bash
# Fire Lab demo: records the voice-over with the Mac voice and adds it to the video.
cd "$(dirname "$0")" || exit 1
VOICE="${1:-Daniel}"   # other English voices: Samantha, Alex, Karen
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p voix
say -v "$VOICE" -r 195 -o voix/l0.aiff "Ask Fire Lab a question about fire on Mars."
say -v "$VOICE" -r 195 -o voix/l1.aiff "It searches NASA's fire experiments and ranks them out of a hundred, best match first."
say -v "$VOICE" -r 195 -o voix/l2.aiff "Open the Mars base, step into the lab."
say -v "$VOICE" -r 195 -o voix/l3.aiff "Add equipment if you need it, then ignite."
say -v "$VOICE" -r 195 -o voix/l4.aiff "The fire spreads, computed live at Mars gravity, down to the second each alarm goes off."
say -v "$VOICE" -r 195 -o voix/l5.aiff "Then measure the air: velocity, streamlines, vorticity and pressure, anywhere in the room."
if command -v ffmpeg >/dev/null; then
  ffmpeg -y -i fire_lab_demo_sans_voix.mp4 -i voix/l0.aiff -i voix/l1.aiff -i voix/l2.aiff -i voix/l3.aiff -i voix/l4.aiff -i voix/l5.aiff -filter_complex "[1:a]adelay=400|400[a0];[2:a]adelay=3330|3330[a1];[3:a]adelay=10930|10930[a2];[4:a]adelay=13530|13530[a3];[5:a]adelay=18000|18000[a4];[6:a]adelay=23500|23500[a5];[a0][a1][a2][a3][a4][a5]amix=inputs=6:normalize=0[v]" -map 0:v -map "[v]" -c:v copy -c:a aac -b:a 192k fire_lab_demo_avec_voix.mp4 && echo "OK: fire_lab_demo_avec_voix.mp4"
else
  echo "ffmpeg absent: les phrases sont dans le dossier voix/. Glisse-les dans iMovie aux temps du fichier voix_off.txt."
fi
read -r -p "Entrée pour fermer…" _
