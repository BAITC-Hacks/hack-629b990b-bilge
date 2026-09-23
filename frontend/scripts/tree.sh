#!/usr/bin/env bash
# Дерево исходников platform/ с размерами строк (без node_modules/assets).
cd "$(dirname "$0")/.."
{
  find src server tests -type f 2>/dev/null | sort | while read -r f; do printf '%5s %s\n' "$(wc -l < "$f")" "$f"; done
  echo "--- vite.config.ts"; cat vite.config.ts
  echo "--- seed users/teams"; grep -n "id: 'user-\|id: 'biz-\|id: 'team-\|avatarPreset\|displayName" src/api/seed.ts | head -60
  echo "--- world imports"; grep -rn "^import" src/pages/World.tsx
  echo "--- node"; node -v
  echo TREE_DONE
} > tree.txt 2>&1
