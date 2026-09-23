#!/usr/bin/env bash
# Повторная загрузка с сайтов, которые сбрасывали соединение: запросы с браузерным User-Agent и HTTP/1.1.
# Только загрузка/распаковка CC0-моделей в public/models/raw; ничего не выполняется.
set -u
cd "$(dirname "$0")/.."
RAW=public/models/raw
mkdir -p "$RAW"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
get() { curl -fsSL --http1.1 -A "$UA" --retry 3 --retry-delay 2 --max-time 120 "$@"; }
log() { printf '\n## %s\n' "$*"; }

kenney() { # slug
  local slug="$1" url
  if [ -d "$RAW/kenney-$slug" ]; then log "kenney-$slug: уже есть"; return; fi
  url=$(get "https://kenney.nl/assets/$slug" | grep -Eo "https://kenney\.nl/media/pages/assets/$slug/[^\"' ]+\.zip" | head -1)
  log "kenney-$slug: ${url:-ссылка не найдена}"
  [ -n "$url" ] || return
  get -o "$RAW/kenney-$slug.zip" "$url" && unzip -q -o "$RAW/kenney-$slug.zip" -d "$RAW/kenney-$slug" && rm -f "$RAW/kenney-$slug.zip" && echo "ok kenney-$slug"
}

polypizza() { # имя, url бандла
  local name="$1" page="$2" ids id html glb
  log "$name: $page"
  mkdir -p "$RAW/$name"
  ids=$(get "$page" | grep -Eo '/m/[A-Za-z0-9_-]+' | sort -u)
  [ -n "$ids" ] || { echo "модели не найдены на странице"; return; }
  for id in $ids; do
    html=$(get "https://poly.pizza$id" || true)
    glb=$(printf '%s' "$html" | grep -Eo 'https://static\.poly\.pizza/[A-Za-z0-9-]+\.glb' | head -1)
    title=$(printf '%s' "$html" | grep -Eo '<title>[^<]+' | head -1 | sed 's/<title>//; s/ - .*//; s/[^A-Za-z0-9 _-]//g; s/ /_/g')
    if [ -n "$glb" ]; then
      get -o "$RAW/$name/${title:-$(basename "$id")}.glb" "$glb" && echo "ok ${title:-$id}"
    else
      echo "нет GLB: $id"
    fi
  done
}

kenney car-kit
kenney city-kit-commercial
polypizza quaternius-cyberpunk https://poly.pizza/bundle/Cyberpunk-Game-Kit-Hkfxa8K8zF
polypizza quaternius-men https://poly.pizza/bundle/Animated-Men-Pack-DAC9SDgMQT

log "Итого"
du -sh "$RAW"/* 2>/dev/null
echo "GLB/glTF: $(find "$RAW" \( -iname '*.glb' -o -iname '*.gltf' \) | wc -l)"
echo FETCH2_DONE
