# AI Sana — frontend (2D screens + multiplayer 3D campus)

React 19 + TypeScript + Vite 8 + three 0.186 + React Three Fiber 9 + drei 10. The only data source is the BFF in [`../backend`](../backend/README.md), via its typed client `backend/client/index.ts`.

## Screenshots

Real frames from the 3D campus (Chromium, 1600×1000). The hero shot is a fly-over of the plaza.

### 3D Campus

![AI Sana 3D campus](docs/screenshots/3d-world-overview.png)

### Multiplayer

![Two players in the shared world](docs/screenshots/multiplayer.png)

### Grand Triumph event

![Grand Triumph](docs/screenshots/grand-triumph.png)

### Task interaction

![Task pavilion interaction](docs/screenshots/task-building.png)

### World map

![3D world map](docs/screenshots/world-map.png)

Also: [player on the street](docs/screenshots/player-world.png), [debug view `?debug3d=1`](docs/screenshots/debug-3d.png).

## Running
```bash
cd backend && npm ci && cp .env.example .env   # once; the OpenAI key lives only in backend/.env
cd ../frontend && npm install
npm run dev:all      # BFF :3001 + Vite :5173 (proxies /api and /socket.io)
```
Open http://localhost:5173. Demo profile login codes are in the local `backend/demo-accounts.local.json` (not in git). Quick login link: `#/login?code=<code>&name=<in-world name>`. `npm run bots` starts demo bots (labelled "demo") for solo presentations.

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run dev:all` | Vite only / BFF and Vite together |
| `npm run build` | type check + build `dist/` (served by the BFF with `FRONTEND_DIST=../frontend/dist`) |
| `npm test` | world layout, collisions, interpolation |
| `npm run assets` | copies the selected CC0 models from `assets-raw/` to `public/models/` |

## Screens
Code login and team creation · dashboard (business: tasks and next step; team: applications, selection, milestones) · task builder (description breakdown with quotes, one clarifying question at a time, forecast and official score, confirmation, publishing) · application comparison · milestone (Git materials, business decision) · catalog · leaderboard · 3D world.

## 3D world (`src/3d/`)
Triumph Plaza in the center, up to 8 main pavilions (the most ready tasks), the remaining tasks are industry buildings on plots placed by `seed = hash(task.id)`; team bases, map (M), emotes 1–4, idle actions, NPCs, cars, birds, a drone; GRAND TRIUMPH fires only from the server's `world.triumph` after the business confirms a milestone. Player presence is Socket.IO via the BFF (`backend/src/world.ts`), 12 Hz with interpolation; the participant name is only used for the nameplate (in the BFF a team shares one code). Debug: `#/world?debug3d=1`.

Models are CC0: Kenney City Kit (Commercial), Car Kit, Mini (characters/forest/market/arcade/skate/trophy), KayKit City Builder Bits; licenses in `public/models/LICENSES.txt`.

Verified 2026-09-23 in a browser: the scene renders, WASD and the `M` map work, two clients see each other, the task card opens, GRAND TRIUMPH was caught after the business confirmed a milestone. `?debug3d=1` showed 60 FPS in that session. A stable 60 FPS on arbitrary hardware is not claimed; visually distinct synchronization of emotes 1–4 was not recorded.
