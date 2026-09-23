// Сервер: REST + Socket.IO на временной БД в памяти. ИИ в режиме stub (никаких платных вызовов в тестах).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.NODE_ENV = 'test';
process.env.AI_MODE = 'stub';
delete process.env.OPENAI_API_KEY;

const { createApp } = await import('../server/index.ts');
const { io: ioc } = await import('socket.io-client');

const srv = createApp({ dbFile: ':memory:' });
await new Promise<void>((r) => srv.http.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
after(async () => { await srv.close(); });

async function call(method: string, url: string, token?: string | null, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() as any };
}
async function login(userId: string | null) { return (await call('POST', '/api/login', null, { userId })).data.token as string; }
function connect(token: string | null) {
  const s = ioc(base, { auth: { token }, transports: ['websocket'], forceNew: true });
  return new Promise<typeof s>((r) => s.on('connect', () => r(s)));
}
const wait = <T,>(s: any, ev: string, ms = 2000) => new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (v: T) => { clearTimeout(t); res(v); }); });

test('вход, снимок: гость видит задачи, но не может откликнуться; черновики скрыты', async () => {
  const g = await login(null);
  const snap = (await call('GET', '/api/snapshot', g)).data;
  assert.ok(snap.tasks.length >= 30);
  assert.equal(snap.tasks.some((t: any) => t.id.startsWith('draft-')), false);
  assert.equal(snap.aiMode, 'stub');
  const r = await call('POST', `/api/tasks/${snap.tasks[0].id}/proposals`, g, { idea: 'x'.repeat(20), plan: 'y'.repeat(20), estimatedTime: '2 недели', prototypeUrl: 'https://example.com' });
  assert.equal(r.status, 401);
  assert.equal((await call('GET', '/api/snapshot', 'forged-token')).status, 401);
});

test('мультиплеер: вход, движение (≤ скорости), эмоция, выход; личность задаёт сервер', async () => {
  const ta = await login('user-team-datanomads');
  const tb = await login('user-team-datanomads-2');
  const a = await connect(ta);
  const b = await connect(tb);
  const ja: any = await new Promise((r) => a.emit('world.player.join', { p: [0, 0, 50] }, r));
  assert.equal(ja.you, 'user-team-datanomads');
  const joined = wait<any>(a, 'world.player.join');
  const jb: any = await new Promise((r) => b.emit('world.player.join', { p: [2, 0, 50], displayName: 'Взломщик' }, r));
  const other = await joined;
  assert.equal(other.userId, 'user-team-datanomads-2');
  assert.equal(other.displayName, 'Аян', 'имя берётся из сессии, а не от клиента');
  assert.equal(other.teamName, 'Data Nomads');
  assert.equal(jb.players.length, 2);

  // телепорт на 100 м за один пакет режется до допустимого шага
  const state = wait<any[]>(a, 'world.player.state');
  b.emit('world.player.move', { p: [80, 0, -80], r: 1, m: 'run' });
  const batch = await state;
  const me = batch.find((x) => x.id === 'user-team-datanomads-2');
  assert.ok(me && Math.hypot(me.p[0] - 2, me.p[2] - 50) < 20, 'скорость ограничена сервером');

  const act = wait<any>(a, 'world.player.action');
  b.emit('world.player.action', { action: 'hack-points' });
  b.emit('world.player.action', { action: 'wave' });
  const got = await act;
  assert.equal(got.action, 'wave', 'неизвестные действия игнорируются');

  const left = wait<any>(a, 'world.player.leave');
  b.disconnect();
  assert.equal((await left).userId, 'user-team-datanomads-2');
  a.disconnect();
});

test('GRAND TRIUMPH: только после подтверждения бизнесом; отклик и отправка этапа его не вызывают', async () => {
  const biz = await login('biz-damdi');
  const team = await login('user-team-datanomads');
  const watcher = await connect(await login(null));
  await new Promise((r) => watcher.emit('world.player.join', {}, r));
  let triumphs = 0;
  watcher.on('world.triumph', () => { triumphs++; });

  const id = (await call('POST', '/api/tasks', biz, { rawDescription: 'В кафе остаётся много непроданной еды.', industry: 'HoReCa' })).data.result;
  await call('POST', `/api/tasks/${id}/answers`, biz, { answers: { expectedResult: 'Дашборд списаний по блюдам и дням недели', users: 'Шеф-повар' } });
  const own = (await call('GET', '/api/snapshot', biz)).data.ownTasks.find((t: any) => t.id === id);
  await call('PUT', `/api/tasks/${id}/draft`, biz, { draft: { ...own.draft, title: 'Меньше списаний еды в кафе' } });
  assert.equal((await call('POST', `/api/tasks/${id}/confirm`, biz)).status, 200);
  assert.equal((await call('POST', `/api/tasks/${id}/publish`, biz)).status, 200);

  const before = (await call('GET', '/api/snapshot', team)).data.tasks.find((t: any) => t.id === id).score.total;
  assert.equal((await call('POST', `/api/tasks/${id}/proposals`, team, { idea: 'Дашборд списаний на Streamlit', plan: 'Разбор данных, прототип, проверка', estimatedTime: '6 недель', prototypeUrl: 'https://github.com/example/p' })).status, 200);
  const after1 = (await call('GET', '/api/snapshot', team)).data.tasks.find((t: any) => t.id === id);
  assert.equal(after1.score.total, before, 'отклик не меняет готовность задачи');
  assert.equal(after1.offersCount, 1);

  const propId = (await call('GET', '/api/snapshot', biz)).data.ownProposals.find((p: any) => p.taskId === id).id;
  await call('POST', `/api/proposals/${propId}/decision`, biz, { decision: 'select' });
  await call('POST', `/api/tasks/${id}/milestones`, team, { title: 'Дашборд списаний', acceptanceCriteria: 'Показывает списания по дням недели' });
  const ms = (await call('GET', '/api/snapshot', team)).data.milestones.find((m: any) => m.taskId === id);
  await call('POST', `/api/milestones/${ms.id}/evidence`, team, { evidenceUrl: 'https://github.com/example/p/pull/1', evidenceNote: 'Дашборд и загрузка Excel' });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(triumphs, 0, 'отправка этапа не вызывает триумф');
  assert.equal((await call('POST', `/api/milestones/${ms.id}/decision`, team, { decision: 'approve' })).status, 403, 'команда не может подтвердить сама');

  const tri = wait<any>(watcher, 'world.triumph');
  assert.equal((await call('POST', `/api/milestones/${ms.id}/decision`, biz, { decision: 'approve' })).status, 200);
  const t = await tri;
  assert.equal(t.taskId, id);
  assert.equal(t.teamName, 'Data Nomads');
  assert.equal((await call('POST', `/api/milestones/${ms.id}/decision`, biz, { decision: 'approve' })).status, 400, 'повторное подтверждение отклонено');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(triumphs, 1, 'триумф ровно один раз');
  const snap = (await call('GET', '/api/snapshot', team)).data;
  assert.equal(snap.teams.find((x: any) => x.id === 'team-datanomads').confirmedPoints, 10);
  assert.equal(snap.achievements[0].taskId, id);
  watcher.disconnect();
});

test('запросы с чужого источника отклоняются', async () => {
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ userId: null }) });
  assert.equal(res.status, 403);
});
