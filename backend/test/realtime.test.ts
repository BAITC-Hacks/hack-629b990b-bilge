import { afterEach, beforeEach, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Store } from '../src/db.js';
import type { DomainEvent } from '../src/contracts.js';
import { createAiProvider } from '../src/integrations/ai.js';
import { createGitProvider } from '../src/integrations/git.js';

let runtime: ReturnType<typeof createApp>;
let store: Store;
let sockets: Socket[];
let business: string;
let address: string;
beforeEach(async () => {
  store = new Store();
  runtime = createApp({
    store,
    ai: createAiProvider({ mode: 'stub' }),
    git: createGitProvider({ mode: 'mock' }),
    rateLimit: false,
  });
  sockets = [];
  runtime.auth.addUser(
    { id: 'business', role: 'business', displayName: 'Кафе', teamId: null },
    'realtime-code',
  );
  business = runtime.auth.login('realtime-code').token;
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
  const socket = io(address, { auth: token ? { token } : {}, autoConnect: false, transports: ['websocket'] });
  sockets.push(socket);
  const ready = new Promise<void>((resolve, reject) => {
    socket.once('sync.required', () => resolve());
    socket.once('connect_error', reject);
  });
  socket.connect();
  await ready;
  return socket;
}
it('sends private draft updates only to owner, public publication to both, and requests fresh data on reconnect', async () => {
  const owner = await connect(business);
  const guest = await connect();
  const privateEvents: unknown[] = [];
  guest.on('invalidate', (event) => privateEvents.push(event));
  const ownEvent = new Promise<DomainEvent>((r) => owner.once('invalidate', r));
  const start = await request(runtime.app)
    .post('/api/v1/tasks/start')
    .auth(business, { type: 'bearer' })
    .send({ rawDescription: 'Списания в кафе', industry: 'Общепит' });
  await ownEvent;
  expect(privateEvents).toHaveLength(0);
  const id = start.body.data.task.id;
  const c = await request(runtime.app)
    .post(`/api/v1/tasks/${id}/confirm`)
    .auth(business, { type: 'bearer' })
    .send({ expectedVersion: 1 });
  const published = new Promise<{ type: string; taskId: string }>((r) => guest.once('invalidate', r));
  await request(runtime.app)
    .post(`/api/v1/tasks/${id}/publish`)
    .auth(business, { type: 'bearer' })
    .send({ expectedVersion: c.body.data.task.version });
  expect(await published).toMatchObject({ type: 'task.published', taskId: id });
  guest.disconnect();
  const sync = new Promise<void>((r) => guest.once('sync.required', () => r()));
  guest.connect();
  await sync;
  const snapshot = await request(runtime.app).get('/api/v1/snapshot');
  expect(snapshot.body.data.catalog.cards[0].id).toBe(id);
  expect(snapshot.body.data.dashboard).toBeNull();
});
it('disconnects the private socket immediately when its session is logged out', async () => {
  const socket = await connect(business);
  const disconnected = new Promise<void>((r) => socket.once('disconnect', () => r()));
  await request(runtime.app).post('/api/v1/session/end').auth(business, { type: 'bearer' }).send({});
  await disconnected;
  expect(socket.connected).toBe(false);
});
it('refreshes the open scoreboard when a new team joins without exposing its code or token', async () => {
  const guest = await connect();
  const events: unknown[] = [];
  guest.on('invalidate', (event) => events.push(event));
  const created = await request(runtime.app).post('/api/v1/teams/start').send({ name: 'Новая команда' });
  expect(created.status).toBe(201);
  await expect.poll(() => events.length, { timeout: 1000 }).toBe(1);
  expect(events[0]).toMatchObject({
    type: 'team.created',
    entityId: created.body.data.team.id,
    taskId: null,
    invalidate: ['scoreboard'],
  });
  expect(JSON.stringify(events)).not.toContain(created.body.data.code);
  expect(JSON.stringify(events)).not.toContain(created.body.data.token);
  expect((await request(runtime.app).get('/api/v1/scoreboard')).body.data.teams[0].name).toBe(
    'Новая команда',
  );
});
it('refreshes public pending markers on submission and return while keeping evidence private', async () => {
  const post = (token: string, path: string, body: object) =>
    request(runtime.app).post(`/api/v1${path}`).auth(token, { type: 'bearer' }).send(body);
  const team = await request(runtime.app).post('/api/v1/teams/start').send({ name: 'Команда' });
  const token = team.body.data.token;
  const start = await post(business, '/tasks/start', {
    rawDescription: 'Списания кафе',
    industry: 'Общепит',
  });
  const taskId = start.body.data.task.id;
  const confirmed = await post(business, `/tasks/${taskId}/confirm`, { expectedVersion: 1 });
  await post(business, `/tasks/${taskId}/publish`, { expectedVersion: confirmed.body.data.task.version });
  const proposed = await post(token, `/tasks/${taskId}/proposals`, {
    idea: 'Прогноз',
    plan: 'Прототип',
    estimatedTime: 'Неделя',
    prototypeUrl: 'https://example.com',
  });
  const proposal = proposed.body.data.myProposals[0];
  await post(business, `/proposals/${proposal.id}/decision`, {
    expectedVersion: proposal.version,
    decision: 'select',
  });
  const created = await post(token, `/tasks/${taskId}/milestones`, {
    title: 'Прогноз',
    acceptanceCriteria: 'Проверка CSV',
  });
  const stage = created.body.data.milestone;
  const guest = await connect();
  const owner = await connect(business);
  const events: { type: string; invalidate: string[] }[] = [];
  const ownerEvents: { type: string; invalidate: string[] }[] = [];
  guest.on('invalidate', (event) => events.push(event));
  owner.on('invalidate', (event) => ownerEvents.push(event));
  const submitted = await post(token, `/milestones/${stage.id}/evidence`, {
    expectedVersion: stage.version,
    evidenceUrl: 'https://github.com/example/private-work',
    description: 'Личные материалы команды',
  });
  expect(submitted.status).toBe(200);
  await expect.poll(() => events.length, { timeout: 1000 }).toBe(1);
  expect(events[0]).toMatchObject({ type: 'milestone.changed', taskId });
  await expect.poll(() => ownerEvents.length, { timeout: 1000 }).toBe(1);
  expect(ownerEvents[0]!.invalidate).toContain('milestone');
  const returned = await post(business, `/milestones/${stage.id}/decision`, {
    expectedVersion: submitted.body.data.milestone.version,
    decision: 'return',
    feedback: 'Приватный комментарий бизнеса',
  });
  expect(returned.status).toBe(200);
  await expect.poll(() => events.length, { timeout: 1000 }).toBe(2);
  expect(events[1]!.type).toBe('milestone.decided');
  expect(JSON.stringify(events)).not.toMatch(/Личные материалы|Приватный комментарий|private-work/);
  expect(
    (await request(runtime.app).get('/api/v1/catalog')).body.data.world.stations[0].pendingMilestones,
  ).toBe(0);
  expect((await request(runtime.app).get(`/api/v1/milestones/${stage.id}`)).status).toBe(401);
});
