#!/usr/bin/env bash
# Список современных городских ассетов (Kenney City/Car, KayKit City) с размерами.
cd "$(dirname "$0")/.."
{
  for d in "assets-raw/kenney-city-kit-commercial/Models/GLB format" "assets-raw/kenney-car-kit/Models/GLB format" "assets-raw/kaykit-city/addons/kaykit_city_builder_bits/Assets/gltf"; do
    echo "== $d"
    ls "$d"
  done
  echo "== textures"
  find assets-raw/kenney-city-kit-commercial assets-raw/kenney-car-kit assets-raw/kaykit-city -iname '*.png' | head -20
  echo "== existing inventory lines (city/car/kaykit)"
  grep -E "city-kit|car-kit|kaykit-city" models-inventory.txt | cut -c1-220
  echo LIST_DONE
} > modern-list.txt 2>&1
