# AI Sana — Business Challenge Quality Rating & Open Team Selection

Interactive multiplayer 3D campus for discovering AI Sana business challenges.

![3D Campus](3d-world-overview.png)
Team **Bilge**, HackAlem · "Gamification of Practical Tasks" case study.

Watch our demo video here: https://drive.google.com/drive/folders/1PKSJU6z9LSoA1dz7B01vrEgPE5YPXJvW

Businesses describe a problem in their own words. AI helps flesh out the description, while the server transparently calculates the task card's readiness score (0–100). The task is published to a general catalog, which is also visualized as a live 3D campus. Student teams select tasks and submit proposals; the business then manually chooses one, several, or no teams. Teams earn points only for stages validated by the business.

**The primary gamification element is for businesses:** the more complete and useful the description, the higher the rating and catalog placement. The rating reflects the task's readiness for student collaboration, not the company's fame.

---

## 1. Launch (Single Team)

Requires only **Node.js 22.12+** (https://nodejs.org). From the repository root:

```sh
npm start        # dependencies → build → server: http://127.0.0.1:3001
npm run check    # checks: backend/frontend types & tests, build, smoke test (result: PASS/FAIL)
```

- `npm start` generates `backend/.env` from `backend/.env.example`. **Everything works without an OpenAI key**; AI queries run in a clearly indicated fallback mode. For live AI functionality, specify `OPENAI_API_KEY` in `backend/.env` and restart.
- Upon startup, **login codes and direct links** (for 2 businesses and 5 teams) are printed to the console. Codes are stored in the local `backend/demo-accounts.local.json` file, which is excluded from Git. You can also log in as a guest.
- Each browser tab represents a separate role. For example, the "business" role in one tab and the "team" role in another.
- `npm run start:bots` launches the application along with demo players in the 3D world (marked as "demo").
- `npm run check` starts the server using a temporary database, with AI in `stub` mode and Git in `mock` mode—meaning no external calls, costs, or modifications to your actual data.
- If the port is already in use: `PORT=3005 npm start`. In PowerShell: `$env:PORT=3005; npm start`.
- Development with hot reloading: `cd frontend && npm run dev:all` → http://localhost:5173. API Documentation: http://127.0.0.1:3001/api/docs

## 2. Architecture

```
frontend/  React 19 + TypeScript + Vite 8 + React Three Fiber (three.js)
│  2D screens: login, dashboard, builder, catalog, item details, responses, stage, rating
│  3D campus: task buildings, team bases, online players, GRAND TRIUMPH
│  Typed client backend/client/index.ts (HTTP) + socket.io-client
▼
backend/   BFF: Node.js + TypeScript + Express 5 + Zod + SQLite (better-sqlite3) + Socket.IO
├─ src/app.ts            HTTP API /api/v1 (OpenAPI 3.1 → /api/docs), CORS/Origin, rate limiting
├─ src/services/         Business logic & invariants: tasks, responses, selection, stages, scoring
├─ src/domain/score.ts   Readiness formula (Section 3)
├─ src/views.ts          Screen models, available actions, next steps
├─ src/integrations/     OpenAI (Responses API, Luna) & Git/PR checks — swappable, with fallback mode
├─ src/realtime.ts       invalidate/sync.required events after SQLite writes
└─ src/world.ts          3D player presence, emotes, world.triumph, GET /api/v1/world
```

- **Server as the source of truth.** The client does not send scores, team names, or solutions. Permissions are verified for every operation: role, task owner, selected team.
- **Versioning and retries.** Changes are protected by `expectedVersion`: in case of conflict, the server returns 409 and does not overwrite concurrent edits. Task, response, and stage creation are idempotent (`Idempotency-Key`). - **Real-time.** Clients receive an event after every change and refresh the screen. The same task appears identically in both the 2D catalog and the 3D world.
- **Storage.** SQLite (`backend/data/ai-sana.db`) persists across restarts. Secrets are stored only on the server and are not committed to Git.
- **3D world.**
- A high-rated task appears as the main pavilion by the monument in the center of the square. Other tasks appear as buildings in districts organized by industry. 
- Building placement is stable, determined by `seed = hash(task.id)`. 
- The completion level alters the building's appearance, beacon, and label. 
- Player synchronization occurs via Socket.IO at 12 Hz with movement smoothing. Walking and emotes do not award points. 
- The GRAND TRIUMPH event triggers only after the business confirms the stage. 
- The 2D catalog opens if WebGL is unavailable.

## 3. Task rating formula

Points are awarded only for fields **confirmed** by the business (`backend/src/domain/score.ts`, scale from the technical specification, section 4):

| Category | Points | Condition |
|---|---:|---|
| Context and need | 10 + 10 | description of current situation / what needs changing |
| Data and materials | 10 + 10 | data availability status known (yes/no) / real source named if available |
| Expected result | 15 | specific team output described |
| Success criterion | 15 | metric/indicator |
