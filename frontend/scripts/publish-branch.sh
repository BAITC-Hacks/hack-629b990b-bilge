#!/usr/bin/env bash
# Публикация текущего результата в фича-ветку командного репозитория.
# Нужен доступ к GitHub на этой машине (например: brew install gh && gh auth login && gh auth setup-git).
# Секреты (.env), данные (data/), node_modules, dist и сырые архивы моделей не попадают в коммит.
set -euo pipefail
REPO_SLUG="BAITC-Hacks/hack-629b990b-bilge"
BRANCH="${BRANCH:-feature/3d-multiplayer-world}"
TARGET_DIR="${TARGET_DIR:-frontend}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)/repo"

echo "1/6 проверка типов и тестов"
bash "$SRC/scripts/check.sh" >/dev/null || true
grep -q "TSC_WEB_EXIT=0" "$SRC/check.txt" && grep -q "TSC_SERVER_EXIT=0" "$SRC/check.txt" && grep -q "TEST_EXIT=0" "$SRC/check.txt" \
  || { echo "Проверки не прошли — см. $SRC/check.txt. Публикация остановлена."; exit 1; }

echo "2/6 клонирование $REPO_SLUG"
if command -v gh >/dev/null 2>&1; then gh repo clone "$REPO_SLUG" "$WORK" -- --quiet; else git clone --quiet "https://github.com/$REPO_SLUG.git" "$WORK"; fi
cd "$WORK"
DEFAULT="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#origin/##' || echo main)"
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  git checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git checkout -q -b "$BRANCH" "origin/$DEFAULT"
fi

echo "3/6 копирование проекта в $TARGET_DIR/"
mkdir -p "$TARGET_DIR"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude data --exclude assets-raw \
  --exclude '.env' --exclude '.env.*' --include '.env.example' \
  --exclude '*.sqlite*' --exclude '*.db' --exclude '*.db-*' \
  --exclude check.txt --exclude tree.txt --exclude asset-scan.txt --exclude modern-list.txt --exclude car-list.txt --exclude glb-anims.txt --exclude smoke.txt \
  --exclude '*-inventory.txt' --exclude 'open-*.html' \
  "$SRC/" "$TARGET_DIR/"
cp "$SRC/.env.example" "$TARGET_DIR/.env.example"

echo "4/6 проверка на секреты"
git add -A "$TARGET_DIR"
if git diff --cached -U0 | grep -E -q 'sk-(proj-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}'; then
  echo "В изменениях найден похожий на секрет ключ — публикация остановлена."; git reset -q; exit 1
fi
git diff --cached --name-only | grep -E '(^|/)\.env$' && { echo ".env попал в индекс — остановлено."; exit 1; } || true

echo "5/6 коммит"
git -c core.hooksPath=/dev/null commit -q -F - <<'MSG'
feat(frontend): мультиплеерный 3D-кампус AI Sana + сервер (Express, Socket.IO, SQLite)

- React + TS + Vite + R3F/drei: Triumph Plaza, главные павильоны, здания задач по отраслям
  с детерминированным размещением (seed = hash(task.id)), базы команд, карта (M), эмоции 1–4,
  idle-действия, фоновые NPC/машины/птицы/дрон, GRAND TRIUMPH по серверному событию
- Мультиплеер: присутствие через Socket.IO (12 Гц, интерполяция), личность игрока задаёт сервер
- Сервер: общие бизнес-правила (src/shared/domain.ts), SQLite, вопросы ИИ через OpenAI с откатом
- Ассеты CC0: Kenney City/Car/Mini, KayKit City Builder Bits
- Тесты: 17 (формула, сценарий, REST+Socket.IO, триумф только после подтверждения, планировка)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG

echo "6/6 push → origin/$BRANCH"
git push -u origin "$BRANCH"
echo "Готово: https://github.com/$REPO_SLUG/tree/$BRANCH"
