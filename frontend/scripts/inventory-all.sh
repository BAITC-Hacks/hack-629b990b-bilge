#!/usr/bin/env bash
# Опись всех GLB/GLTF в проекте и в Downloads (Kenney), плюс сведения о бэкенде app/.
set -u
OUT="$(cd "$(dirname "$0")/.." && pwd)/asset-scan.txt"
{
  echo "== GLB/GLTF in project (excluding node_modules) =="
  find /Users/ddd/projects/hackalem \( -name node_modules -o -name .git \) -prune -o \( -iname '*.glb' -o -iname '*.gltf' \) -print 2>/dev/null | sed 's|/Users/ddd/projects/hackalem/||' | awk -F/ '{d=$0; sub(/\/[^\/]*$/,"",d); c[d]++} END{for(k in c) print c[k], k}' | sort -k2
  echo
  echo "== Kenney-like folders/archives in Downloads =="
  find /Users/ddd/Downloads -maxdepth 2 \( -iname '*kenney*' -o -iname '*mini*' -o -iname '*kit*' \) 2>/dev/null | head -50
  echo
  echo "== GLB count in Downloads (depth 6) =="
  find /Users/ddd/Downloads -maxdepth 6 \( -iname '*.glb' -o -iname '*.gltf' \) 2>/dev/null | awk -F/ '{d=$0; sub(/\/[^\/]*$/,"",d); c[d]++} END{for(k in c) print c[k], k}' | sort -k2 | head -60
  echo
  echo "== app/ backend =="
  ls /Users/ddd/projects/hackalem/app 2>/dev/null
  ls /Users/ddd/projects/hackalem/app/server 2>/dev/null
  cat /Users/ddd/projects/hackalem/app/package.json 2>/dev/null
  grep -rln "socket.io\|EventSource\|text/event-stream" /Users/ddd/projects/hackalem/app --include=*.js --include=*.mjs 2>/dev/null | grep -v node_modules | head
  echo
  echo "== platform deps =="
  cat /Users/ddd/projects/hackalem/platform/package.json
  ls /Users/ddd/projects/hackalem/platform/node_modules | grep -i -E "socket|express|sqlite"
  echo SCAN_DONE
} > "$OUT" 2>&1
echo "written $OUT"
