import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Store } from './db.js';
import { commands, type Actor, type AiProvider, type GitProvider } from './contracts.js';
import { Auth } from './auth.js';
import { AppError, invariant } from './errors.js';
import { Tasks } from './services/tasks.js';
import { Work } from './services/work.js';
import { Views } from './views.js';
import { createRealtime } from './realtime.js';
import { openApiDocument } from './openapi.js';
import { WorldPresence, worldView } from './world.js';

export type AppOptions = {
  store: Store;
  ai: AiProvider;
  git: GitProvider;
  allowedOrigins?: string[];
  sessionTtlHours?: number;
  frontendDist?: string;
  rateLimit?: boolean;
};
export function createApp(options: AppOptions) {
  const app = express();
  const httpServer = createServer(app);
  const auth = new Auth(options.store, options.sessionTtlHours ?? 24);
  const origins = options.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const realtime = createRealtime(httpServer, auth, origins);
  const world = new WorldPresence(realtime.io, options.store);
  const tasks = new Tasks(options.store, options.ai, (event) => realtime.emit(event));
  const work = new Work(tasks, options.git);
  const views = new Views(options.store, tasks);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin))
      return next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'This interface origin is not allowed by the server'));
    next();
  });
  app.use(
    cors({
      origin: origins,
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  const limiter = (limit: number) =>
    rateLimit({
      windowMs: 60_000,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(
          new AppError(
            429,
            'RATE_LIMITED',
            'Too many requests. Try again in a minute.',
            {},
            'retry_later',
          ),
        ),
    });
  if (options.rateLimit !== false) {
    app.use('/api', limiter(240));
    app.use(['/api/v1/session/start', '/api/v1/teams/start'], limiter(30));
    app.use(
      ['/api/v1/tasks/:id/analyze', '/api/v1/tasks/:id/clarify', '/api/v1/milestones/:id/evidence'],
      limiter(20),
    );
  }
  const token = (req: Request) => {
    const header = req.headers.authorization;
    if (!header) return undefined;
    invariant(
      /^Bearer [A-Za-z0-9_-]{20,200}$/.test(header),
      401,
      'INVALID_SESSION',
      'Invalid session format',
    );
    return header.slice(7);
  };
  const optional = (req: Request) => auth.resolve(token(req));
  const actor = (req: Request): Actor => {
    const user = optional(req);
    invariant(user, 401, 'LOGIN_REQUIRED', 'Sign in to perform this action');
    return user;
  };
  const id = (req: Request) => req.params.id as string;
  const key = (req: Request) => req.header('Idempotency-Key');
  const send = (res: Response, data: unknown, message: string | null = null, status = 200) =>
    res.status(status).json({
      data,
      feedback: message ? { kind: 'success', message } : null,
      meta: { requestId: res.locals.requestId, contractVersion: '1.0' },
    });
  const api = express.Router();
  api.get('/health', (_req, res) =>
    send(res, {
      status: 'ok',
      database: options.store.db.prepare('SELECT 1').get() ? 'ready' : 'unavailable',
    }),
  );
  api.get('/bootstrap', (req, res) => send(res, views.bootstrap(optional(req))));
  api.post('/session/start', (req, res) =>
    send(res, auth.login(commands.session.parse(req.body).code), 'You are signed in'),
  );
  api.post('/session/end', (req, res) => {
    actor(req);
    const value = token(req)!;
    auth.logout(value);
    realtime.revoke(value);
    send(res, { signedOut: true }, 'You are signed out');
  });
  api.post('/teams/start', (req, res) => {
    const created = auth.createTeam(commands.createTeam.parse(req.body));
    realtime.emit({
      type: 'team.created',
      taskId: null,
      entityId: created.team.id,
      version: 1,
      visibility: 'public',
      userIds: [],
      invalidate: ['scoreboard'],
    });
    send(res, created, 'Team created. Save your sign-in code.', 201);
  });
  api.get('/catalog', (req, res) =>
    send(res, views.catalog(optional(req), commands.catalog.parse(req.query))),
  );
  api.get('/dashboard', (req, res) => send(res, views.dashboard(actor(req))));
  api.get('/scoreboard', (_req, res) => send(res, views.scoreboard()));
  api.get('/world', (_req, res) => send(res, worldView(options.store)));
  api.get('/snapshot', (req, res) => {
    const user = optional(req);
    send(res, {
      bootstrap: views.bootstrap(user),
      catalog: views.catalog(user),
      dashboard: user ? views.dashboard(user) : null,
      scoreboard: views.scoreboard(),
    });
  });
  api.post('/tasks/start', (req, res) => {
    const user = actor(req);
    const task = tasks.start(user, commands.start.parse(req.body), key(req));
    send(res, views.workspace(task.id, user), 'Draft saved', 201);
  });
  api.get('/tasks/:id', (req, res) => send(res, views.detail(id(req), optional(req))));
  api.get('/tasks/:id/workspace', (req, res) => send(res, views.workspace(id(req), actor(req))));
  api.get('/tasks/:id/review', (req, res) => send(res, views.review(id(req), actor(req))));
  api.post('/tasks/:id/draft', (req, res) => {
    const user = actor(req);
    const task = tasks.draft(user, id(req), commands.draft.parse(req.body));
    send(
      res,
      views.workspace(task.id, user),
      'Draft saved. Confirm the changes to update the score.',
    );
  });
  api.post('/tasks/:id/answers', (req, res) => {
    const user = actor(req);
    const task = tasks.answers(user, id(req), commands.answers.parse(req.body));
    const workspace = views.workspace(task.id, user);
    send(
      res,
      workspace,
      workspace.clarification?.nextQuestion
        ? 'Answer saved. Go to the next question or come back later.'
        : 'Answers saved. Review the card and confirm the details.',
    );
  });
  api.post('/tasks/:id/analyze', async (req, res) => {
    const user = actor(req);
    const task = await tasks.analyze(user, id(req), commands.version.parse(req.body).expectedVersion);
    send(
      res,
      views.workspace(task.id, user),
      task.analysis?.suggestions.length
        ? 'Suggestions are ready. Check the quotes before adding them.'
        : 'Description saved. Fill in the fields manually or continue to clarifying questions.',
    );
  });
  api.post('/tasks/:id/suggestions/apply', (req, res) => {
    const user = actor(req);
    const input = commands.applySuggestions.parse(req.body);
    const task = tasks.applySuggestions(user, id(req), input);
    send(
      res,
      views.workspace(task.id, user),
      input.suggestionIds.length
        ? 'Selected details added to the draft. Review the card before confirming.'
        : 'Suggestions dismissed. Your details are kept.',
    );
  });
  api.post('/tasks/:id/clarify', async (req, res) => {
    const user = actor(req);
    const task = await tasks.clarify(user, id(req), commands.version.parse(req.body).expectedVersion);
    send(res, views.workspace(task.id, user), 'Clarifying questions are ready');
  });
  api.post('/tasks/:id/confirm', (req, res) => {
    const user = actor(req);
    const task = tasks.confirm(user, id(req), commands.version.parse(req.body).expectedVersion);
    send(res, views.workspace(task.id, user), 'Details confirmed, rating recalculated');
  });
  api.post('/tasks/:id/publish', (req, res) => {
    const user = actor(req);
    const task = tasks.publish(user, id(req), commands.version.parse(req.body).expectedVersion);
    send(res, views.workspace(task.id, user), 'Task published to all teams');
  });
  api.post('/tasks/:id/proposals', (req, res) => {
    const user = actor(req);
    work.propose(user, id(req), commands.proposal.parse(req.body), key(req));
    send(res, views.detail(id(req), user), 'Proposal sent', 201);
  });
  api.post('/proposals/:id/decision', (req, res) => {
    const user = actor(req);
    const item = work.decide(user, id(req), commands.decision.parse(req.body));
    send(res, views.review(item.taskId, user), 'Decision saved');
  });
  api.post('/tasks/:id/milestones', (req, res) => {
    const user = actor(req);
    const item = work.createMilestone(user, id(req), commands.milestone.parse(req.body), key(req));
    send(res, views.milestone(item.id, user), 'Milestone created', 201);
  });
  api.get('/milestones/:id', (req, res) => send(res, views.milestone(id(req), actor(req))));
  api.post('/milestones/:id/evidence', async (req, res) => {
    const user = actor(req);
    const item = await work.evidence(user, id(req), commands.evidence.parse(req.body));
    send(res, views.milestone(item.id, user), 'The result is awaiting business review. No points awarded yet.');
  });
  api.post('/milestones/:id/decision', (req, res) => {
    const user = actor(req);
    const input = commands.review.parse(req.body);
    const alreadyApproved = work.milestone(id(req)).status === 'approved';
    const item = work.review(user, id(req), input);
    // GRAND TRIUMPH in the 3D world: only on the first approval of a milestone (after the SQLite write).
    if (item.status === 'approved' && !alreadyApproved) world.triumph(item);
    send(
      res,
      views.milestone(item.id, user),
      item.status === 'approved'
        ? alreadyApproved
          ? 'Milestone already approved. No points awarded again.'
          : 'Milestone approved. The team earned 10 points.'
        : 'Milestone returned for rework',
    );
  });
  app.get('/api/openapi.json', (_req, res) => res.json(openApiDocument));
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      swaggerOptions: { persistAuthorization: false },
      customSiteTitle: 'AI Sana BFF API',
    }),
  );
  app.use('/api/v1', api);
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', 'API route not found')));
  if (options.frontendDist) {
    const root = resolve(options.frontendDist);
    app.use(express.static(root));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(root, 'index.html')));
  }
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let error: AppError;
    if (err instanceof z.ZodError) {
      const fields: Record<string, string[]> = {};
      for (const issue of err.issues) {
        const field = issue.path.join('.') || '_form';
        (fields[field] ??= []).push(issue.message);
      }
      error = new AppError(422, 'VALIDATION_ERROR', 'Check the highlighted fields', fields, 'correct_fields');
    } else if (err instanceof AppError) error = err;
    else if (err instanceof SyntaxError && 'body' in err)
      error = new AppError(400, 'INVALID_JSON', 'Could not parse the request JSON');
    else if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.too.large')
      error = new AppError(413, 'BODY_TOO_LARGE', 'Request is too large');
    else {
      error = new AppError(
        500,
        'INTERNAL_ERROR',
        'Could not complete the action. Please retry.',
        {},
        'retry',
      );
      console.error(
        `[${res.locals.requestId}] Internal error`,
        err instanceof Error ? err.message : 'unknown',
      );
    }
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
        recovery: error.recovery,
      },
      meta: { requestId: res.locals.requestId, contractVersion: '1.0' },
    });
  });
  return {
    app,
    httpServer,
    io: realtime.io,
    auth,
    tasks,
    work,
    views,
    world,
    close: () => {
      world.close();
      return realtime.close();
    },
  };
}
