#!/usr/bin/env bash
# Все наборы Kenney «Mini …» (CC0) из https://kenney.nl/assets/category:3D — по просьбе пользователя.
set -u
cd "$(dirname "$0")/.."
RAW=assets-raw
mkdir -p "$RAW"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
for slug in mini-market mini-forest mini-arena mini-skate mini-arcade mini-dungeon; do
  dir="$RAW/kenney-$slug"
  if [ -d "$dir" ]; then echo "$slug: already"; continue; fi
  url=$(curl -fsSL --http1.1 -A "$UA" "https://kenney.nl/assets/$slug" | grep -Eo "https://kenney\.nl/media/pages/assets/$slug/[^\"' ]+\.zip" | head -1)
  echo "$slug: ${url:-NOT FOUND}"
  [ -n "$url" ] && curl -fsSL --http1.1 -A "$UA" --retry 3 -o "$RAW/$slug.zip" "$url" && unzip -q -o "$RAW/$slug.zip" -d "$dir" && rm -f "$RAW/$slug.zip"
done
: > mini-inventory.txt
for d in "$RAW"/kenney-mini-*; do node scripts/inspect-glb.mjs "$d/Models/GLB format" >> mini-inventory.txt 2>&1 || node scripts/inspect-glb.mjs "$d" >> mini-inventory.txt; done
du -sh "$RAW"/kenney-mini-*
wc -l mini-inventory.txt
echo MINI_DONE
