import { afterEach, beforeEach, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Store } from '../src/db.js';
import type { AiProvider, DomainEvent, GitProvider } from '../src/contracts.js';

let runtime: ReturnType<typeof createApp>;
let store: Store;
let sockets: Socket[];
let business: string;
let address: string;
const ai: AiProvider = {
  async clarify() {
    throw new Error('unused');
  },
  async reviewEvidence() {
    throw new Error('unused');
  },
};
const git: GitProvider = {
  async inspect() {
    throw new Error('unused');
  },
};
beforeEach(async () => {
  store = new Store();
  runtime = createApp({ store, ai, git, rateLimit: false });
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
