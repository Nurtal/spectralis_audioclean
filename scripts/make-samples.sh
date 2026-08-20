#!/usr/bin/env bash
# Fabrique les trois extraits de démonstration de public/samples/.
#
# La voix est synthétisée (flite), le bruit est construit au filtre : ce sont
# des BOUCHONS reproductibles, pas des prises réelles. Ils existent pour que la
# démo ait quelque chose à mordre dès le premier chargement. À remplacer par de
# vraies prises — trois défauts, trois voix, en français.
#
# Les phrases sont synthétisées séparément puis recollées avec des blancs. Une
# vraie prise respire : ce sont ces blancs que le débruiteur écoute pour
# apprendre le bruit, et un fichier de parole continue ne ressemble à rien.
#
# Dépendances : ffmpeg compilé avec libflite et libmp3lame.
# Usage : bash scripts/make-samples.sh
set -euo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/public/samples"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

DURATION=20
SR=48000
GAP=0.85

silence() { # durée, sortie
  ffmpeg -v error -f lavfi -i "anullsrc=r=$SR:cl=mono" -t "$1" \
    -c:a pcm_s16le -y "$2"
}

# Synthétise chaque phrase à part, puis recolle avec des blancs.
say_lines() { # voix, sortie, phrase...
  local voice="$1" out="$2"
  shift 2
  local list="$TMP/list.txt"
  : > "$list"
  silence 0.45 "$TMP/gap-lead.wav"
  silence $GAP "$TMP/gap.wav"
  echo "file '$TMP/gap-lead.wav'" >> "$list"
  local i=0
  for line in "$@"; do
    ffmpeg -v error -f lavfi -i "flite=text='$line':voice=$voice" \
      -ar $SR -ac 1 -c:a pcm_s16le -y "$TMP/part-$i.wav"
    echo "file '$TMP/part-$i.wav'" >> "$list"
    echo "file '$TMP/gap.wav'" >> "$list"
    i=$((i + 1))
  done
  ffmpeg -v error -f concat -safe 0 -i "$list" -c copy -y "$out"
}

# Niveau de la voix, identique partout : c'est le bruit qui change.
level_voice() { # in, out, lufs
  ffmpeg -v error -i "$1" -af "loudnorm=I=$3:TP=-3:LRA=11,apad" -t $DURATION \
    -ar $SR -ac 1 -y "$2"
}

mix() { # voix, bruit, sortie
  ffmpeg -v error -i "$1" -i "$2" \
    -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:normalize=0[a]" \
    -map "[a]" -ar $SR -ac 1 -y "$3"
}

encode() { # in, out
  ffmpeg -v error -i "$1" -codec:a libmp3lame -b:a 64k -ac 1 -ar 44100 \
    -write_xing 0 -id3v2_version 0 -y "$2"
}

# ── 1. Interview en salle climatisée ────────────────────────────────────────
# Ronflement : harmoniques de 50 Hz + grondement brun sous 250 Hz, avec une
# lente ondulation — un compresseur qui tourne n'est jamais parfaitement stable.
say_lines slt "$TMP/v1.wav" \
  "This is the second half of the interview." \
  "I started the company in a spare room, with one microphone and a laptop." \
  "The first year was mostly learning what not to do." \
  "We still work that way, more or less." \
  "People ask what changed since then." \
  "The room got bigger. The questions got harder."
level_voice "$TMP/v1.wav" "$TMP/v1n.wav" -20
ffmpeg -v error \
  -f lavfi -i "anoisesrc=color=brown:sample_rate=$SR:duration=$DURATION:amplitude=0.9,lowpass=f=250:poles=2,lowpass=f=250:poles=2" \
  -f lavfi -i "sine=frequency=50:sample_rate=$SR:duration=$DURATION" \
  -f lavfi -i "sine=frequency=100:sample_rate=$SR:duration=$DURATION" \
  -f lavfi -i "sine=frequency=150:sample_rate=$SR:duration=$DURATION" \
  -filter_complex "[0:a]volume=0.5[b];[1:a]volume=0.06[h1];[2:a]volume=0.03[h2];[3:a]volume=0.015[h3];\
[b][h1][h2][h3]amix=inputs=4:normalize=0,tremolo=f=0.35:d=0.25,volume=0.42[n]" \
  -map "[n]" -ar $SR -ac 1 -y "$TMP/n1.wav"
mix "$TMP/v1n.wav" "$TMP/n1.wav" "$TMP/m1.wav"
encode "$TMP/m1.wav" "$OUT/interview-clim.mp3"

# ── 2. Podcast, souffle de préampli ─────────────────────────────────────────
# Souffle : bruit blanc légèrement basculé vers l'aigu, constant. Le défaut du
# micro dynamique poussé à fond sur une entrée bon marché.
say_lines rms "$TMP/v2.wav" \
  "Before we get to the questions, a quick note about the recording." \
  "I am using the same setup as last week." \
  "Which I promised to fix, and did not." \
  "You will hear it, and I would rather say so now." \
  "Consider it part of the show." \
  "Next month there will be a proper preamplifier."
level_voice "$TMP/v2.wav" "$TMP/v2n.wav" -21
ffmpeg -v error \
  -f lavfi -i "anoisesrc=color=white:sample_rate=$SR:duration=$DURATION:amplitude=0.9" \
  -af "highpass=f=400:poles=1,treble=g=6:f=6000,volume=0.055" \
  -ar $SR -ac 1 -y "$TMP/n2.wav"
mix "$TMP/v2n.wav" "$TMP/n2.wav" "$TMP/m2.wav"
encode "$TMP/m2.wav" "$OUT/podcast-souffle.mp3"

# ── 3. Voix captée dans la rue ──────────────────────────────────────────────
# Large bande, non stationnaire : fond rose continu plus des passages de
# véhicules — c'est le cas où le gate spectral montre ses limites et où le
# réseau neuronal prend l'avantage.
say_lines awb "$TMP/v3.wav" \
  "We are standing on the corner." \
  "Which is why this sounds the way it does." \
  "The market runs until noon, then the street empties out." \
  "Ask anyone here and they will tell you the same thing." \
  "Though they will each tell it differently." \
  "That is the part I wanted on tape."
level_voice "$TMP/v3.wav" "$TMP/v3n.wav" -20
ffmpeg -v error \
  -f lavfi -i "anoisesrc=color=pink:sample_rate=$SR:duration=$DURATION:amplitude=0.9" \
  -f lavfi -i "anoisesrc=color=brown:sample_rate=$SR:duration=$DURATION:amplitude=0.9" \
  -filter_complex "[0:a]lowpass=f=4000:poles=2,volume=0.10[p];\
[1:a]lowpass=f=700:poles=2,tremolo=f=0.18:d=0.9,volume=0.55[cars];\
[p][cars]amix=inputs=2:normalize=0,volume=0.85[n]" \
  -map "[n]" -ar $SR -ac 1 -y "$TMP/n3.wav"
mix "$TMP/v3n.wav" "$TMP/n3.wav" "$TMP/m3.wav"
encode "$TMP/m3.wav" "$OUT/voix-rue.mp3"

echo "Extraits écrits dans $OUT :"
ls -l "$OUT"
