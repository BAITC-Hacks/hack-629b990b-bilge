import { afterEach, beforeEach, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Store } from '../src/db.js';
import { createAiProvider } from '../src/integrations/ai.js';
import { createGitProvider } from '../src/integrations/git.js';
import { cleanName } from '../src/world.js';

let runtime: ReturnType<typeof createApp>;
let store: Store;
let sockets: Socket[];
let address: string;
let business: string;
beforeEach(async () => {
  store = new Store();
  runtime = createApp({
    store,
    ai: createAiProvider({ mode: 'stub' }),
    git: createGitProvider({ mode: 'mock' }),
    rateLimit: false,
  });
  sockets = [];
  runtime.auth.addUser({ id: 'business', role: 'business', displayName: 'Кафе', teamId: null }, 'world-biz-code');
  business = runtime.auth.login('world-biz-code').token;
  await new Promise<void>((r) => runtime.httpServer.listen(0, '127.0.0.1', r));
  const addr = runtime.httpServer.address();
  if (!addr || typeof addr === 'string') throw new Error('address');
  address = `http://127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  sockets.forEach((s) => s.disconnect());
  await runtime.close();
  store.close();
});
async function connect(token?: string) {
  const socket = io(address, { auth: token ? { token } : {}, transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('sync.required', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}
const next = <T>(s: Socket, ev: string) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ev}`)), 2000);
    s.once(ev, (v: T) => {
      clearTimeout(t);
      resolve(v);
    });
  });
const join = (s: Socket, body: object) =>
  new Promise<{ you: string; players: { displayName: string; teamName: string | null }[] }>((r) =>
    s.emit('world.player.join', body, r),
  );
const post = (token: string, path: string, body: object) =>
  request(runtime.app).post(`/api/v1${path}`).auth(token, { type: 'bearer' }).send(body);

it('shows teammates as separate players with the session team; limits speed; whitelists emotes; announces leave', async () => {
  const team = await request(runtime.app).post('/api/v1/teams/start').send({ name: 'Bilge', color: '#6366f1' });
  const code = team.body.data.code as string;
  const t1 = team.body.data.token as string;
  const t2 = (await request(runtime.app).post('/api/v1/session/start').send({ code })).body.data.token as string;
  const a = await connect(t1);
  const b = await connect(t2);
  await join(a, { p: [0, 0, 50], name: 'Бейбарыс' });
  const joined = next<{ userId: string; displayName: string; teamName: string; teamColor: string }>(a, 'world.player.join');
  const res = await join(b, { p: [2, 0, 50], name: '<b>Аян</b>' });
  const other = await joined;
  expect(res.players).toHaveLength(2);
  expect(other.displayName).toBe('bАян/b');
  expect(other.teamName).toBe('Bilge');
  expect(other.teamColor).toBe('#6366f1');

  const state = next<{ id: string; p: number[] }[]>(a, 'world.player.state');
  b.emit('world.player.move', { p: [80, 0, -80], r: 1, m: 'run' });
  const moved = (await state).find((x) => x.id === other.userId)!;
  expect(Math.hypot(moved.p[0]! - 2, moved.p[2]! - 50)).toBeLessThan(20);

  const act = next<{ action: string }>(a, 'world.player.action');
  b.emit('world.player.action', { action: 'give-points' });
  b.emit('world.player.action', { action: 'wave' });
  expect((await act).action).toBe('wave');

  const left = next<{ userId: string }>(a, 'world.player.leave');
  b.disconnect();
  expect((await left).userId).toBe(other.userId);
});

it('emits world.triumph once, only after the business approves; proposal and submission do not trigger it', async () => {
  const team = await request(runtime.app).post('/api/v1/teams/start').send({ name: 'Qadam', color: '#059669' });
  const token = team.body.data.token as string;
  const guest = await connect();
  await join(guest, {});
  const triumphs: { taskId: string; teamName: string }[] = [];
  guest.on('world.triumph', (t) => triumphs.push(t));

  const start = await post(business, '/tasks/start', { rawDescription: 'Списания кафе', title: 'Кафе', industry: 'Общепит' });
  const taskId = start.body.data.task.id;
  const confirmed = await post(business, `/tasks/${taskId}/confirm`, { expectedVersion: start.body.data.task.version });
  await post(business, `/tasks/${taskId}/publish`, { expectedVersion: confirmed.body.data.task.version });
  const proposed = await post(token, `/tasks/${taskId}/proposals`, {
    idea: 'Прогноз',
    plan: 'Прототип',
    estimatedTime: 'Неделя',
    prototypeUrl: 'https://example.com',
  });
  const proposal = proposed.body.data.myProposals[0];
  await post(business, `/proposals/${proposal.id}/decision`, { expectedVersion: proposal.version, decision: 'select' });
  const stage = (await post(token, `/tasks/${taskId}/milestones`, { title: 'Прогноз', acceptanceCriteria: 'CSV' })).body
    .data.milestone;
  const submitted = await post(token, `/milestones/${stage.id}/evidence`, {
    expectedVersion: stage.version,
    evidenceUrl: 'https://github.com/example/work',
    description: 'Прототип',
  });
  await new Promise((r) => setTimeout(r, 150));
  expect(triumphs).toHaveLength(0);
  const selfApprove = await post(token, `/milestones/${stage.id}/decision`, {
    expectedVersion: submitted.body.data.milestone.version,
    decision: 'approve',
  });
  expect(selfApprove.status).toBe(403);

  const tri = next<{ taskId: string; teamName: string }>(guest, 'world.triumph');
  const approved = await post(business, `/milestones/${stage.id}/decision`, {
    expectedVersion: submitted.body.data.milestone.version,
    decision: 'approve',
  });
  expect(approved.status).toBe(200);
  expect(await tri).toMatchObject({ taskId, teamName: 'Qadam' });
  await post(business, `/milestones/${stage.id}/decision`, {
    expectedVersion: approved.body.data.milestone.version,
    decision: 'approve',
  });
  await new Promise((r) => setTimeout(r, 150));
  expect(triumphs).toHaveLength(1);

  const world = (await request(runtime.app).get('/api/v1/world')).body.data;
  expect(world.achievements[0]).toMatchObject({ taskId, teamName: 'Qadam', taskTitle: 'Кафе' });
  expect(world.teams.find((t: { name: string }) => t.name === 'Qadam')).toMatchObject({ color: '#059669', confirmedPoints: 10 });
  expect(JSON.stringify(world)).not.toContain('example/work');
});

it('sanitizes display names', () => {
  expect(cleanName('  Дана\u0007  ')).toBe('Дана');
  expect(cleanName('x'.repeat(40))).toHaveLength(24);
  expect(cleanName(42)).toBe('');
});
