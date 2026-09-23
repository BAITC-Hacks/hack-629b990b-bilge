// Демо-боты для показа мира одним человеком: настоящие Socket.IO-клиенты BFF под демо-кодами команд
// из локального backend/demo-accounts.local.json. Проходят тот же серверный путь, что и игроки
// (вход, движение 12 Гц, эмоции), помечены «демо» в интерфейсе. Баллы и бизнес-данные не трогают.
// Запуск (бэкенд должен работать): npm run bots   (BOTS=6 по умолчанию, SERVER_URL=http://127.0.0.1:3001)
import { readFileSync } from 'node:fs';
import { io } from 'socket.io-client';
import { buildLayout, resolveCollisions } from '../src/3d/world/WorldLayout';
import { EMOTES, NET_HZ, WALK_SPEED } from '../src/shared/world';

const BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:3001';
const COUNT = Number(process.env.BOTS ?? 6);
const NAMES = ['Аян', 'Дана', 'Тимур', 'Асель', 'Ержан', 'Камила', 'Санжар', 'Айжан', 'Даулет', 'Жансая'];
const headers = { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' };

type Account = { role: string; displayName: string; teamId: string | null; code: string };
const file = new URL('../../backend/demo-accounts.local.json', import.meta.url);
const raw = JSON.parse(readFileSync(file, 'utf8')) as Account[] | { accounts: Account[] };
const teamAccounts = (Array.isArray(raw) ? raw : raw.accounts).filter((a) => a.role === 'team');
if (!teamAccounts.length) throw new Error('В backend/demo-accounts.local.json нет командных кодов');

const get = async (path: string) => (await (await fetch(BASE + '/api/v1' + path, { headers })).json()).data;
const cards: { id: string; industry: string; readinessScore: number; publishedAt: string }[] = [];
for (let p = 1; ; p++) {
  const c = await get(`/catalog?pageSize=50&page=${p}`);
  cards.push(...c.cards);
  if (p >= c.pagination.totalPages) break;
}
const world = await get('/world');
const layout = buildLayout(cards.map((c) => ({ id: c.id, industry: c.industry, score: { total: c.readinessScore }, publishedAt: c.publishedAt })), world.teams.map((t: { id: string }) => t.id));
const fronts = layout.placements.map((p) => [p.x + Math.sin(p.rot) * (p.featured ? 6 : 7), p.z + Math.cos(p.rot) * (p.featured ? 6 : 7)] as [number, number]);

for (let i = 0; i < COUNT; i++) {
  const acc = teamAccounts[i % teamAccounts.length];
  const res = await fetch(BASE + '/api/v1/session/start', { method: 'POST', headers, body: JSON.stringify({ code: acc.code }) });
  if (!res.ok) { console.error('не удалось войти:', acc.displayName, res.status); continue; }
  const { token } = (await res.json()).data;
  const socket = io(BASE, { auth: { token }, transports: ['websocket'], extraHeaders: { Origin: 'http://localhost:5173' } });
  const base = acc.teamId ? layout.byTeam[acc.teamId] : null;
  let x = (base?.x ?? 0) + (Math.random() - 0.5) * 6, z = (base?.z ?? 30) - 8, r = Math.PI;
  let target: [number, number] = [x, z];
  let pauseUntil = Date.now() + Math.random() * 4000;
  let stuck = 0;
  const pick = (): [number, number] => {
    const k = Math.random();
    if (k < 0.45 && fronts.length) return fronts[Math.floor(Math.random() * fronts.length)];
    if (k < 0.75) { const a = Math.random() * Math.PI * 2; return [Math.sin(a) * 23, Math.cos(a) * 23]; }
    return base ? [base.x, base.z - 7] : [0, 27];
  };
  socket.on('connect', () => socket.emit('world.player.join', { p: [x, 0, z], r, name: NAMES[i % NAMES.length], demo: true }, (ack: { error?: string }) => {
    if (ack?.error) console.error(acc.displayName, ack.error); else console.log(`бот в мире: ${NAMES[i % NAMES.length]} (${acc.displayName})`);
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
console.log(`Демо-ботов: ${COUNT} → ${BASE}. Остановить: Ctrl+C`);
