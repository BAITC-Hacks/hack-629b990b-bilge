// Сервер платформы: Express (REST) + Socket.IO (изменения данных, присутствие в 3D-мире, GRAND TRIUMPH) + SQLite.
// Сервер — источник истины: все правила из src/shared/domain.ts выполняются здесь.
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { ApiError, demoAccounts, ops, publicUser, snapshot, userOf, type TriumphInfo } from '../src/shared/domain';
import { config } from './config';
import { clarify as aiClarify } from './ai';
import { Store } from './store';
import { WorldPresence } from './world';

const here = path.dirname(fileURLToPath(import.meta.url));
const ALLOW_RESET = process.env.ALLOW_DEMO_RESET !== '0';

export function createApp(opts: { dbFile?: string } = {}) {
  const store = new Store(opts.dbFile ?? config.databasePath, config.sessionTtlMs);
  const app = express();
  const http = createServer(app);
  const io = new Server(http, { cors: { origin: config.allowedOrigins, credentials: false }, maxHttpBufferSize: 1e5 });
  const world = new WorldPresence(io, store);
  const aiMode = () => (config.ai.mode !== 'stub' && config.ai.hasKey() ? 'openai' : 'stub') as 'openai' | 'stub';

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // изменения только с разрешённых источников (ALLOWED_ORIGINS) или того же хоста
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      let sameHost = false;
      try { sameHost = new URL(origin).host === req.headers.host; } catch { /* нет */ }
      if (!sameHost && !config.allowedOrigins.includes(origin)) { res.status(403).json({ error: 'Запрос с этого сайта запрещён' }); return; }
    }
    next();
  });
  app.use(express.json({ limit: '200kb' }));

  const token = (req: Request) => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : null;
  };
  /** Идентификатор пользователя из сессии; null — гость. Недействительный токен — 401. */
  const actor = (req: Request): string | null => {
    const t = token(req);
    if (!t) return null;
    const s = store.session(t);
    if (!s) throw new ApiError('Сессия истекла, войдите заново', 401);
    return s.userId;
  };
  const changed = (revision: number, reason: string) => io.emit('data.changed', { revision, reason });
  type Handler = (req: Request, res: Response) => unknown;
  const route = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
    try { await fn(req, res); } catch (e) { next(e); }
  };
  /** Мутация: правила → запись в SQLite → оповещение всех клиентов. */
  const mutation = (reason: string, fn: (req: Request, a: string | null) => (s: ReturnType<Store['read']>) => unknown) =>
    route((req, res) => {
      const a = actor(req);
      const { result, revision } = store.mutate(fn(req, a));
      changed(revision, reason);
      res.json({ ok: true, result: result ?? null, revision });
    });

  app.get('/api/health', (_req, res) => { res.json({ ok: true, world: world.stats() }); });
  app.get('/api/accounts', route((_req, res) => { res.json(demoAccounts(store.read())); }));

  app.post('/api/login', route((req, res) => {
    const userId = req.body?.userId ?? null;
    if (userId !== null && (typeof userId !== 'string' || !userOf(store.read(), userId))) throw new ApiError('Аккаунт не найден', 404);
    const t = store.createSession(userId);
    const u = userOf(store.read(), userId);
    res.json({ token: t, me: u ? publicUser(u) : null });
  }));
  app.post('/api/logout', route((req, res) => { const t = token(req); if (t) store.deleteSession(t); res.json({ ok: true }); }));

  app.get('/api/snapshot', route((req, res) => { res.json({ ...snapshot(store.read(), actor(req)), aiMode: aiMode() }); }));
  app.get('/api/world/stats', route((_req, res) => { res.json(world.stats()); }));

  app.post('/api/tasks', mutation('task.created', (req, a) => (s) => ops.createTask(s, a, req.body?.rawDescription, req.body?.industry)));
  app.post('/api/tasks/:id/clarify', route(async (req, res) => {
    const a = actor(req);
    const id = String(req.params.id);
    const input = ops.clarifyInput(store.read(), a, id); // проверка прав до вызова модели
    const result = await aiClarify(input.raw, input.draft); // ключ OpenAI только на сервере; без ключа — локальные вопросы
    const { revision } = store.mutate((s) => ops.saveClarify(s, a, id, result));
    changed(revision, 'task.clarified');
    res.json({ ok: true, result, revision });
  }));
  app.put('/api/tasks/:id/draft', mutation('task.draft', (req, a) => (s) => ops.saveDraft(s, a, String(req.params.id), req.body?.draft, req.body?.answers)));
  app.post('/api/tasks/:id/answers', mutation('task.draft', (req, a) => (s) => ops.applyAnswers(s, a, String(req.params.id), req.body?.answers)));
  app.post('/api/tasks/:id/confirm', mutation('task.confirmed', (req, a) => (s) => ops.confirm(s, a, String(req.params.id))));
  app.post('/api/tasks/:id/publish', mutation('task.published', (req, a) => (s) => ops.publish(s, a, String(req.params.id))));
  app.post('/api/tasks/:id/proposals', mutation('proposal.created', (req, a) => (s) => ops.createProposal(s, a, String(req.params.id), req.body ?? {})));
  app.post('/api/proposals/:id/decision', mutation('proposal.decided', (req, a) => (s) => ops.decide(s, a, String(req.params.id), req.body?.decision)));
  app.post('/api/tasks/:id/milestones', mutation('milestone.created', (req, a) => (s) => ops.createMilestone(s, a, String(req.params.id), req.body ?? {})));
  app.post('/api/milestones/:id/evidence', mutation('milestone.submitted', (req, a) => (s) => ops.submitEvidence(s, a, String(req.params.id), req.body ?? {})));
  app.post('/api/milestones/:id/decision', route((req, res) => {
    const a = actor(req);
    const { result, revision } = store.mutate((s) => ops.decideMilestone(s, a, String(req.params.id), req.body?.decision));
    changed(revision, 'milestone.decided');
    // GRAND TRIUMPH — только после подтверждения бизнесом и успешной записи; клиент вызвать его не может.
    if (result) io.to('world').emit('world.triumph', result satisfies TriumphInfo);
    res.json({ ok: true, result: null, revision });
  }));
  app.post('/api/demo/reset', route((req, res) => {
    if (!ALLOW_RESET) throw new ApiError('Сброс демо-данных отключён', 403);
    // из локальной сети (другие устройства) сбрасывать нельзя — только с этой машины
    const host = String(req.headers.host ?? '').split(':')[0];
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new ApiError('Сброс демо-данных доступен только на компьютере с сервером', 403);
    const revision = store.reset();
    world.refreshIdentities();
    changed(revision, 'demo.reset');
    res.json({ ok: true, revision });
  }));

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Не найдено' }); });
  // Ошибки: ApiError — понятное сообщение и поле; остальное — без подробностей наружу.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) { res.status(err.status).json({ error: err.message, field: err.field }); return; }
    if (err instanceof SyntaxError) { res.status(400).json({ error: 'Некорректный JSON' }); return; }
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  // Продакшен: собранный фронтенд (FRONTEND_DIST или ./dist).
  const dist = config.frontendDist ?? path.join(here, '..', 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => { res.sendFile(path.join(dist, 'index.html')); });
  }

  io.on('connection', (socket) => world.attach(socket));

  return { app, http, io, store, world, close: () => new Promise<void>((r) => { world.stop(); io.close(); http.close(() => r()); }) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { http } = createApp();
  http.listen(config.port, config.host, () => console.log(`AI Sana server: http://${config.host}:${config.port} · API + Socket.IO · ИИ: ${config.ai.mode !== 'stub' && config.ai.hasKey() ? `OpenAI (${config.ai.model})` : 'локальные вопросы'} · БД: ${path.relative(process.cwd(), config.databasePath)}`));
}
