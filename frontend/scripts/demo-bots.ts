// Демо-боты для показа мира одним человеком: настоящие Socket.IO-клиенты под демо-учётками участников команд.
// Они проходят тот же серверный путь, что и игроки (вход, 12 Гц движение, эмоции), и помечены «демо» в интерфейсе.
// Баллы и бизнес-данные не трогают. Запуск: npm run bots  (сервер должен работать; BOTS=6 по умолчанию)
import { io } from 'socket.io-client';
import { buildLayout, resolveCollisions } from '../src/3d/world/WorldLayout';
import { EMOTES, NET_HZ, WALK_SPEED } from '../src/shared/world';
import type { Snapshot } from '../src/shared/types';

const BASE = process.env.SERVER_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`;
const COUNT = Number(process.env.BOTS ?? 6);
const USERS = ['user-team-datanomads-2', 'user-team-datanomads-3', 'user-team-bytecraft', 'user-team-qazml-2', 'user-team-pixelsteppe', 'user-team-tulpar-2', 'user-team-bytecraft-2', 'user-team-qazml', 'user-team-pixelsteppe-3', 'user-team-tulpar'];

async function post(url: string, body: unknown, token?: string) {
  const r = await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json() as Promise<any>;
}

const snap = (await (await fetch(BASE + '/api/snapshot')).json()) as Snapshot;
const layout = buildLayout(snap.tasks, snap.teams.map((t) => t.id));
const taskFronts = layout.placements.map((p) => [p.x + Math.sin(p.rot) * (p.featured ? 6 : 7), p.z + Math.cos(p.rot) * (p.featured ? 6 : 7)] as [number, number]);

for (const userId of USERS.slice(0, COUNT)) {
  const { token } = await post('/api/login', { userId });
  const socket = io(BASE, { auth: { token, demo: true }, transports: ['websocket'] });
  const teamId = snap.teams.find((t) => userId.startsWith('user-' + t.id))?.id ?? null;
  const base = teamId ? layout.byTeam[teamId] : null;
  let x = (base?.x ?? 0) + (Math.random() - 0.5) * 6, z = (base?.z ?? 30) - 8, r = Math.PI;
  let target: [number, number] = [x, z];
  let pauseUntil = Date.now() + Math.random() * 4000;
  let stuck = 0;
  const pick = () => {
    const k = Math.random();
    if (k < 0.45) return taskFronts[Math.floor(Math.random() * taskFronts.length)];
    if (k < 0.75) { const a = Math.random() * Math.PI * 2; return [Math.sin(a) * 23, Math.cos(a) * 23] as [number, number]; }
    return base ? [base.x - Math.sign(base.x || 1) * 2, base.z - 7] as [number, number] : [0, 27] as [number, number];
  };
  socket.on('connect', () => socket.emit('world.player.join', { p: [x, 0, z], r }, (res: { error?: string }) => {
    if (res?.error) console.error(userId, res.error); else console.log('бот в мире:', userId);
  }));
  const dt = 1 / NET_HZ;
  setInterval(() => {
    let m: 'idle' | 'walk' = 'idle';
    if (Date.now() > pauseUntil) {
      const dx = target[0] - x, dz = target[1] - z, d = Math.hypot(dx, dz);
      if (d < 1.2 || stuck > 36) {
        target = pick(); stuck = 0;
        pauseUntil = Date.now() + 2500 + Math.random() * 7000;
        if (Math.random() < 0.4) socket.emit('world.player.action', { action: EMOTES[Math.floor(Math.random() * EMOTES.length)] });
      } else {
        const sp = WALK_SPEED * 0.85;
        const [nx, nz] = resolveCollisions(x + (dx / d) * sp * dt, z + (dz / d) * sp * dt, layout.colliders, 0.45, layout.walkLimit);
        stuck = Math.hypot(nx - x, nz - z) < sp * dt * 0.3 ? stuck + 1 : 0;
        x = nx; z = nz; r = Math.atan2(dx, dz); m = 'walk';
      }
    }
    socket.volatile.emit('world.player.move', { p: [x, 0, z], r, m });
  }, 1000 / NET_HZ);
}
console.log(`Демо-ботов: ${Math.min(COUNT, USERS.length)} → ${BASE}. Остановить: Ctrl+C`);
