#!/usr/bin/env bash
# Стилизованные (не реалистичные) CC0-персонажи: Kenney Mini Characters и KayKit Adventurers.
set -u
cd "$(dirname "$0")/.."
RAW=assets-raw
mkdir -p "$RAW"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
if [ ! -d "$RAW/kenney-mini-characters" ]; then
  url=$(curl -fsSL --http1.1 -A "$UA" https://kenney.nl/assets/mini-characters | grep -Eo 'https://kenney\.nl/media/pages/assets/mini-characters/[^"'"'"' ]+\.zip' | head -1)
  echo "kenney mini: ${url:-NOT FOUND}"
  [ -n "$url" ] && curl -fL --http1.1 -A "$UA" --retry 3 -o "$RAW/mini.zip" "$url" && unzip -q -o "$RAW/mini.zip" -d "$RAW/kenney-mini-characters" && rm -f "$RAW/mini.zip"
fi
if [ ! -d "$RAW/kaykit-adventurers" ]; then
  git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 "$RAW/kaykit-adventurers" && rm -rf "$RAW/kaykit-adventurers/.git"
fi
du -sh "$RAW/kenney-mini-characters" "$RAW/kaykit-adventurers" 2>/dev/null
node scripts/inspect-glb.mjs "$RAW/kenney-mini-characters" > characters-inventory.txt 2>&1
node scripts/inspect-glb.mjs "$RAW/kaykit-adventurers" >> characters-inventory.txt 2>&1
wc -l characters-inventory.txt
echo CHAR_DONE
