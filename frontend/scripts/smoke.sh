#!/usr/bin/env bash
# Дымовая проверка: сервер напрямую и через прокси Vite, сборка фронтенда. Вывод — smoke.txt (без секретов).
cd "$(dirname "$0")/.."
{
  echo "--- health (3001)"; curl -s -m 5 http://127.0.0.1:3001/api/health; echo
  echo "--- snapshot via vite proxy (5173)"; curl -s -m 5 http://localhost:5173/api/snapshot | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log("tasks",j.tasks.length,"teams",j.teams.length,"aiMode",j.aiMode,"achievements",j.achievements.length)}catch(e){console.log("ERR",s.slice(0,200))}})'
  echo "--- socket.io handshake via proxy"; curl -s -m 5 "http://localhost:5173/socket.io/?EIO=4&transport=polling" | head -c 120; echo
  echo "--- model files served"; for u in /models/city/building-l.glb /models/kaykit/bench.gltf /models/car/taxi.glb /models/mini/characters/character-male-a.glb; do printf "%s %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://localhost:5173$u)" "$u"; done
  echo "--- vite build"; npx vite build 2>&1 | tail -15; echo "BUILD_EXIT=${PIPESTATUS[0]}"
  echo SMOKE_DONE
} > smoke.txt 2>&1
tail -3 smoke.txt
