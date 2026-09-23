#!/usr/bin/env bash
# Copies the selected modern CC0 campus assets from assets-raw/ to public/models/.
# File names come from the inventories (modern-list.txt, mini-inventory.txt) — nothing is made up.
set -eu
cd "$(dirname "$0")/.."
RAW=assets-raw
OUT=public/models

# Kenney City Kit (Commercial): mid-size buildings, skyscrapers, awnings, parasols
CITY_SRC="$RAW/kenney-city-kit-commercial/Models/GLB format"
mkdir -p "$OUT/city/Textures"
for n in building-a building-b building-c building-d building-e building-f building-g building-h building-i building-j building-k building-l building-m building-n \
         building-skyscraper-a building-skyscraper-b building-skyscraper-c building-skyscraper-d building-skyscraper-e \
         low-detail-building-a low-detail-building-b low-detail-building-c low-detail-building-d low-detail-building-e low-detail-building-f low-detail-building-g \
         low-detail-building-h low-detail-building-i low-detail-building-j low-detail-building-k low-detail-building-l low-detail-building-m low-detail-building-wide-a low-detail-building-wide-b \
         detail-awning detail-awning-wide detail-parasol-a detail-parasol-b; do
  cp "$CITY_SRC/$n.glb" "$OUT/city/"
done
cp "$CITY_SRC/Textures/"*.png "$OUT/city/Textures/"

# Kenney Car Kit: cars, vans, cones, boxes
CAR_SRC="$RAW/kenney-car-kit/Models/GLB format"
mkdir -p "$OUT/car/Textures"
for n in sedan taxi van suv delivery hatchback-sports police ambulance garbage-truck truck cone box; do
  cp "$CAR_SRC/$n.glb" "$OUT/car/"
done
cp "$CAR_SRC/Textures/"*.png "$OUT/car/Textures/"

# KayKit City Builder Bits: benches, streetlights, traffic lights, bushes, hydrants, dumpster
KK_SRC="$RAW/kaykit-city/addons/kaykit_city_builder_bits/Assets/gltf"
mkdir -p "$OUT/kaykit"
for n in bench bush streetlight trafficlight_A trafficlight_B trafficlight_C firehydrant dumpster watertower; do
  cp "$KK_SRC/$n.gltf" "$KK_SRC/$n.bin" "$OUT/kaykit/"
done
cp "$KK_SRC/citybits_texture.png" "$OUT/kaykit/"

# Licenses
if ! grep -q "public/models/kaykit" "$OUT/LICENSES.txt" 2>/dev/null; then
  {
    echo
    echo "Kenney City Kit (Commercial), Kenney Car Kit — kenney.nl, CC0 1.0 (public/models/city, public/models/car)"
    echo "KayKit City Builder Bits — Kay Lousberg (kaylousberg.com), CC0 1.0 (public/models/kaykit)"
  } >> "$OUT/LICENSES.txt"
fi

du -sh "$OUT/city" "$OUT/car" "$OUT/kaykit" "$OUT/mini"
echo ASSETS_DONE
