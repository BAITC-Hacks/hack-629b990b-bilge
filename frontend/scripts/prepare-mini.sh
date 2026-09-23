#!/usr/bin/env bash
# Все 3D-модели мира — только Kenney «Mini …» (CC0), по просьбе пользователя.
# У каждого набора своя палитра Textures/colormap.png, поэтому наборы лежат в отдельных папках.
set -eu
cd "$(dirname "$0")/.."
OUT=public/models
# прежние модели (реалистичные люди, машины, здания Kenney City/Car, KayKit, Quaternius) убираем из сборки;
# исходники остаются в assets-raw
rm -rf "$OUT/people" "$OUT/cars" "$OUT/city" "$OUT/props" "$OUT/cyber" "$OUT/mini"
mkdir -p "$OUT/mini"
for pack in characters forest market arcade arena skate dungeon; do
  src="assets-raw/kenney-mini-$pack/Models/GLB format"
  dst="$OUT/mini/$pack"
  mkdir -p "$dst/Textures"
  cp "$src"/*.glb "$dst/"
  cp "$src/Textures/colormap.png" "$dst/Textures/"
done
{
  echo "Все модели — Kenney (www.kenney.nl), лицензия CC0 1.0 (public domain):"
  for pack in characters forest market arcade arena skate dungeon; do echo "mini/$pack — Kenney Mini $pack (https://kenney.nl/assets/mini-$pack)"; done
} > "$OUT/LICENSES.txt"
du -sh "$OUT"/mini/* "$OUT"
echo MINI_PREP_DONE
