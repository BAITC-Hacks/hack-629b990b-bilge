#!/usr/bin/env bash
# Отбор скачанных CC0-моделей в public/models (раздаются Vite). Исходники уезжают в assets-raw (вне сборки).
set -eu
cd "$(dirname "$0")/.."
if [ -d public/models/raw ]; then mkdir -p assets-raw; rsync -a public/models/raw/ assets-raw/ && rm -rf public/models/raw; fi
SRC=assets-raw
OUT=public/models
rm -rf "$OUT/people" "$OUT/cars" "$OUT/city" "$OUT/props" "$OUT/cyber"
mkdir -p "$OUT/people" "$OUT/cars/Textures" "$OUT/city/Textures" "$OUT/props" "$OUT/cyber"

# Люди — Quaternius Animated Men Pack (CC0), анимации HumanArmature|Man_*
i=1; for f in "$SRC"/quaternius-men/*.glb; do cp "$f" "$OUT/people/man-$i.glb"; i=$((i+1)); done

# Машины — Kenney Car Kit (CC0)
K="$SRC/kenney-car-kit/Models/GLB format"
for n in sedan taxi police ambulance van suv suv-luxury delivery truck firetruck hatchback-sports race-future garbage-truck; do cp "$K/$n.glb" "$OUT/cars/"; done
cp "$K/Textures/colormap.png" "$OUT/cars/Textures/"

# Здания — Kenney City Kit Commercial (CC0)
C="$SRC/kenney-city-kit-commercial/Models/GLB format"
cp "$C"/building-*.glb "$C"/low-detail-building-*.glb "$C"/detail-parasol-*.glb "$OUT/city/"
cp "$C/Textures/colormap.png" "$OUT/city/Textures/"

# Уличные предметы — KayKit City Builder Bits (CC0), glTF + bin + общая текстура
P="$SRC/kaykit-city/addons/kaykit_city_builder_bits/Assets/gltf"
for n in streetlight bench trafficlight_A trafficlight_C firehydrant dumpster watertower bush; do cp "$P/$n.gltf" "$P/$n.bin" "$OUT/props/"; done
cp "$P/citybits_texture.png" "$OUT/props/"

# Киберпанк-детали — Quaternius Cyberpunk Game Kit (CC0)
Q="$SRC/quaternius-cyberpunk"
cp "$Q/rsZJjigt1X.glb" "$OUT/cyber/signs.glb"
cp "$Q/OuHQCigiUR.glb" "$OUT/cyber/antenna-2.glb"
cp "$Q/l5Oc9swvKk.glb" "$OUT/cyber/antenna-1.glb"
cp "$Q/mBGTVozH1u.glb" "$OUT/cyber/tv-1.glb"
cp "$Q/R8DtfW6Nx5.glb" "$OUT/cyber/tv-3.glb"
cp "$Q/amFuyE3IF6.glb" "$OUT/cyber/ac.glb"
cp "$Q/Bq1Qj4DAre.glb" "$OUT/cyber/light-street-1.glb"

# Лицензии
{
  echo "Все модели — CC0 1.0 (public domain)."
  echo "people/ — Quaternius, Animated Men Pack (poly.pizza/bundle/Animated-Men-Pack-DAC9SDgMQT)"
  echo "cars/ — Kenney, Car Kit (kenney.nl/assets/car-kit)"
  echo "city/ — Kenney, City Kit Commercial (kenney.nl/assets/city-kit-commercial)"
  echo "props/ — Kay Lousberg, KayKit City Builder Bits (github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0)"
  echo "cyber/ — Quaternius, Cyberpunk Game Kit (quaternius.com/packs/cyberpunkgamekit.html)"
} > "$OUT/LICENSES.txt"
du -sh "$OUT"/* ; echo PREP_DONE
