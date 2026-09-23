#!/usr/bin/env bash
# Проверка типов (клиент и сервер) и все автотесты. Вывод — в check.txt.
cd "$(dirname "$0")/.."
{
  echo "--- TSC web"; npx tsc -p tsconfig.json --noEmit 2>&1 | head -80; echo "TSC_WEB_EXIT=${PIPESTATUS[0]}"
  echo "--- TSC server"; npx tsc -p tsconfig.server.json --noEmit 2>&1 | head -80; echo "TSC_SERVER_EXIT=${PIPESTATUS[0]}"
  echo "--- TEST"; NODE_ENV=test node --import tsx --test --test-reporter=spec tests/*.test.ts 2>&1 | tail -70; echo "TEST_EXIT=${PIPESTATUS[0]}"
  echo CHECK_DONE
} > check.txt 2>&1
tail -4 check.txt
