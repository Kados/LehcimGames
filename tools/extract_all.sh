#!/bin/sh
# Regenerates the decoded assets used by the browser ports (docs/<game>/assets) from the original files.
# Usage: sh tools/extract_all.sh OUTDIR   (run from the repository root)
set -e
OUT=${1:-extracted}; T=$(dirname "$0")
for a in "awele/IMAWELE.LIO awele/IMAWPAL.bmp awele" "colorsmix/IMCOL.LIO colorsmix/IMCOLPAL.bmp colorsmix" \
         "kevgame/IMKEV3.LIO kevgame/IMKEVPAL.bmp kevgame" "morpion/IMMORP.LIO morpion/IMMORPAL.bmp morpion" \
         "stack/IMSTACK.LIO stack/IMSTPAL.bmp stack"; do
  set -- $a; mkdir -p "$OUT/$3"; python3 "$T/lio2png.py" "$1" "$2" "$OUT/$3/sheet.png"
done
for g in agora/Agora.exe awele/AWELE.EXE colorsmix/Colours_MIX.exe kevgame/KevGame.exe labraph/LabRaph.exe morpion/MORPION.EXE stack/STACK.EXE; do
  n=$(dirname "$g"); python3 "$T/neres.py" "$g" "$OUT/$n/res" > /dev/null; python3 "$T/exe_text.py" "$g" > "$OUT/$n/text.txt"
done
python3 "$T/fcod.py" "$OUT/labraph/res" "$OUT/labraph/res/FCOD_FCOD_1.bin" "$OUT/labraph"
python3 "$T/fcod.py" "$OUT/agora/res" "$OUT/agora/res/FCOD_FCOD_41.bin" "$OUT/agora"
