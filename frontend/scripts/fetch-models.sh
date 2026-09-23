#!/usr/bin/env bash
# Скачивание CC0-моделей для 3D-мира в platform/public/models/raw (разрешено пользователем в чате).
# Только загрузка и распаковка архивов с официальных страниц авторов; ничего из скачанного не выполняется.
set -u
cd "$(dirname "$0")/.."
RAW=public/models/raw
mkdir -p "$RAW"
log() { printf '\n== %s\n' "$*"; }

fetch_git() { # имя, репозиторий
  if [ -d "$RAW/$1/.git" ]; then log "$1: уже скачан"; return; fi
  log "$1: git clone $2"
  git clone --depth 1 "$2" "$RAW/$1" && rm -rf "$RAW/$1/.git"
}

fetch_kenney() { # slug
  local slug="$1" url
  if [ -d "$RAW/kenney-$slug" ]; then log "kenney-$slug: уже скачан"; return; fi
  log "kenney-$slug: ищу архив на https://kenney.nl/assets/$slug"
  url=$(curl -fsSL "https://kenney.nl/assets/$slug" | grep -Eo "https://kenney\.nl/media/pages/assets/$slug/[^\"']+\.zip" | head -1)
  if [ -z "$url" ]; then echo "НЕ НАЙДЕНА прямая ссылка для $slug"; return; fi
  echo "$url"
  curl -fL --max-filesize 300000000 -o "$RAW/kenney-$slug.zip" "$url" && unzip -q -o "$RAW/kenney-$slug.zip" -d "$RAW/kenney-$slug" && rm "$RAW/kenney-$slug.zip"
}

fetch_polypizza_bundle() { # имя, url бандла
  local name="$1" page="$2" urls
  if [ -d "$RAW/$name" ]; then log "$name: уже скачан"; return; fi
  log "$name: ищу GLB на $page"
  urls=$(curl -fsSL "$page" | grep -Eo 'https://static\.poly\.pizza/[A-Za-z0-9-]+\.glb' | sort -u)
  if [ -z "$urls" ]; then echo "НЕ НАЙДЕНЫ прямые GLB на $page"; return; fi
  mkdir -p "$RAW/$name"
  for u in $urls; do curl -fsSL --max-filesize 50000000 -o "$RAW/$name/$(basename "$u")" "$u" && echo "ok $u"; done
}

fetch_git kaykit-city https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0
fetch_git ual https://github.com/J-Ponzo/gltf-universal-animation-library
fetch_kenney car-kit
fetch_kenney city-kit-commercial
fetch_polypizza_bundle quaternius-cyberpunk https://poly.pizza/bundle/Cyberpunk-Game-Kit-Hkfxa8K8zF
fetch_polypizza_bundle quaternius-men https://poly.pizza/bundle/Animated-Men-Pack-DAC9SDgMQT

log "Итого:"
du -sh "$RAW"/* 2>/dev/null
find "$RAW" -iname '*.glb' -o -iname '*.gltf' | wc -l | xargs echo "glTF/GLB файлов:"
echo FETCH_DONE
