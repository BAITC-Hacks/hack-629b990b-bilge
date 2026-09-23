#!/usr/bin/env bash
# Удаляет модули прежнего мира (заменены src/3d/) и их стили; затем проверка типов.
cd "$(dirname "$0")/.."
for f in Island Life Pavilion Environment Player Avatar models; do rm -f "src/world/$f.tsx"; done
node -e '
const fs=require("fs");const f="src/styles.css";let s=fs.readFileSync(f,"utf8");
const a=s.indexOf("/* ===== 3D world ===== */");const b=s.indexOf("@media (max-width: 900px)");
if(a>=0&&b>a){s=s.slice(0,a)+s.slice(b);fs.writeFileSync(f,s);console.log("css: old world styles removed");}else console.log("css: markers not found");
'
ls src/world
echo "--- TSC web"; npx tsc -p tsconfig.json --noEmit 2>&1 | head -60; echo "TSC_WEB_EXIT=${PIPESTATUS[0]}"
echo "--- TSC server"; npx tsc -p tsconfig.server.json --noEmit 2>&1 | head -60; echo "TSC_SERVER_EXIT=${PIPESTATUS[0]}"
echo CHECK_DONE
