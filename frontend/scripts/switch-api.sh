#!/usr/bin/env bash
# Переключает импорты страниц с браузерной заглушки на серверный клиент.
cd "$(dirname "$0")/.."
grep -rl "api/mock'" src --include=*.tsx | while read -r f; do
  perl -pi -e "s#'(\.\./|\./)api/mock'#'\1api'#g" "$f"
  echo "switched: $f"
done
grep -rn "api/mock'" src || echo "no mock imports left in src"
