#!/usr/bin/env bash
# Одна команда: mini-модели в public/models, удаление киберпанка и устаревших модулей, проверка типов и тестов.
set -u
cd "$(dirname "$0")/.."
bash scripts/prepare-mini.sh 2>&1 | tail -10
rm -f src/world/CityFill.tsx src/world/Cyber.tsx
# вырезать стили киберпанка и голографического терминала (блок до подписей сцены)
node -e '
const fs=require("fs");const f="src/styles.css";let s=fs.readFileSync(f,"utf8");
const a=s.indexOf("/* ===== cyberpunk theme ===== */");const b=s.indexOf("/* labels inside the scene (HTML over canvas) */");
if(a>=0&&b>a){s=s.slice(0,a)+s.slice(b);fs.writeFileSync(f,s);console.log("css: cyber/holo styles removed");}else console.log("css: markers not found");
'
grep -rn -i "cyber\|holo\b" src --include=*.tsx --include=*.ts --include=*.css | head -5
echo "--- TSC"; npx tsc -p tsconfig.json --noEmit; echo "TSC_EXIT=$?"
echo "--- TEST"; npm test 2>&1 | tail -12
echo REBUILD_DONE
