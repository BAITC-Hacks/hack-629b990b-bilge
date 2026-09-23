# hack-629b990b-bilge
Hackathon team repository for Bilge

## Backend (AI Sana)

Рабочая серверная часть находится в [`backend/`](backend/README.md): Node.js + TypeScript + Express + SQLite + Socket.IO, OpenAI и проверка Git/PR. Запуск и локальные коды входа описаны в README бэкенда.

Для разработчика фронтенда: [контракты BFF и примеры](docs/backend-integration.md), [типизированный клиент](backend/client/index.ts).

## Frontend и 3D-мир

[`frontend/`](frontend/README.md): React + Vite + React Three Fiber — 2D-экраны и мультиплеерный 3D-кампус на данных BFF. Запуск всего вместе: `cd frontend && npm install && npm run dev:all` (нужен `backend/.env`, см. выше) → http://localhost:5173. Присутствие игроков и GRAND TRIUMPH — `backend/src/world.ts`.
