# AI Sana — 3D Multiplayer Task Campus

Interactive multiplayer 3D campus for discovering AI Sana business challenges.

![3D Campus](frontend/docs/screenshots/3d-world-overview.png)

Students walk a shared WebGL world, see teammates online, open task pavilions, and celebrate a server-driven **GRAND TRIUMPH** when a business confirms a stage result.

See the frontend and 3D docs: [frontend/README.md](frontend/README.md)

## Backend (AI Sana)

Рабочая серверная часть находится в [`backend/`](backend/README.md): Node.js + TypeScript + Express + SQLite + Socket.IO, OpenAI и проверка Git/PR. Запуск и локальные коды входа описаны в README бэкенда.

Для разработчика фронтенда: [контракты BFF и примеры](docs/backend-integration.md), [типизированный клиент](backend/client/index.ts).

## Frontend и 3D-мир

[`frontend/`](frontend/README.md): React + Vite + React Three Fiber — 2D-экраны и мультиплеерный 3D-кампус на данных BFF. Запуск всего вместе: `cd frontend && npm install && npm run dev:all` (нужен `backend/.env`, см. выше) → http://localhost:5173. Присутствие игроков и GRAND TRIUMPH — `backend/src/world.ts`.
