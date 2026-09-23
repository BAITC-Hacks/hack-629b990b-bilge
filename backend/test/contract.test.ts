import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { commands } from '../src/contracts.js';
import { openApiDocument } from '../src/openapi.js';
import { ApiError, createSanaClient } from '../client/index.js';
import { createApp } from '../src/app.js';
import { Store } from '../src/db.js';
import { createAiProvider } from '../src/integrations/ai.js';
import { createGitProvider } from '../src/integrations/git.js';

const envelope = (data: unknown) => ({
  data,
  feedback: null,
  meta: { requestId: 'request-1', contractVersion: '1.0' },
});
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('browser client', () => {
  it('preserves the screen envelope and resolves the current tab token for each request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(envelope({ screen: 'bootstrap' })));
    vi.stubGlobal('fetch', fetcher);
    let token: string | null = null;
    const api = createSanaClient({ baseUrl: 'https://sana.test/api/v1/', getToken: () => token });
    expect(await api.bootstrap()).toEqual(envelope({ screen: 'bootstrap' }));
    expect(new Headers(fetcher.mock.calls[0]![1]!.headers).has('Authorization')).toBe(false);
    token = 'tab-business-session';
    fetcher.mockResolvedValueOnce(reply(envelope({ screen: 'business-dashboard' })));
    await api.dashboard();
    expect(fetcher.mock.calls[1]![0]).toBe('https://sana.test/api/v1/dashboard');
    expect(new Headers(fetcher.mock.calls[1]![1]!.headers).get('Authorization')).toBe(
      'Bearer tab-business-session',
    );
  });

  it('encodes filters and path segments and forwards cancellation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(envelope({})));
    const api = createSanaClient({ fetch: fetcher });
    const controller = new AbortController();
    await api.catalog({ search: 'кафе & еда', page: 2, level: 'ready' }, { signal: controller.signal });
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'https://sana.test');
    expect(url.pathname).toBe('/api/v1/catalog');
    expect(url.searchParams.get('search')).toBe('кафе & еда');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.has('industry')).toBe(false);
    expect(fetcher.mock.calls[0]![1]!.signal).toBe(controller.signal);
    await api.task('unsafe/id?#');
    expect(fetcher.mock.calls[1]![0]).toBe('/api/v1/tasks/unsafe%2Fid%3F%23');
  });

  it('retains a generated creation key after a lost response so the caller can safely retry', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reply(envelope({ screen: 'task-workspace' }), 201));
    const api = createSanaClient({ fetch: fetcher });
    const body = { rawDescription: 'Сократить списания в кафе' };
    const error = await api.startTask(body).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw new Error('Expected ApiError');
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: 0, recovery: 'retry', fieldErrors: {} });
    expect(error.idempotencyKey).toMatch(/^[\w-]{8,120}$/);
    await api.startTask(body, { idempotencyKey: error.idempotencyKey });
    const keys = fetcher.mock.calls.map(([, init]) => new Headers(init!.headers).get('Idempotency-Key'));
    expect(keys).toEqual([error.idempotencyKey, error.idempotencyKey]);
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual(body);
  });

  it('generates distinct keys for distinct proposals and respects an explicit milestone key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(envelope({}), 201));
    const api = createSanaClient({ fetch: fetcher });
    const body = {
      idea: 'Прогноз',
      plan: 'Изучить CSV',
      estimatedTime: 'Неделя',
      prototypeUrl: 'https://example.test/demo',
    };
    await api.propose('task-1', body);
    await api.propose('task-1', body);
    await api.createMilestone(
      'task-1',
      { title: 'Прототип', acceptanceCriteria: 'Импорт CSV' },
      { idempotencyKey: 'milestone-retry-1' },
    );
    const keys = fetcher.mock.calls.map(([, init]) => new Headers(init!.headers).get('Idempotency-Key'));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[2]).toBe('milestone-retry-1');
  });

  it('exposes server validation and conflict recovery without replacing their details', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      reply(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Проверьте поля',
            fieldErrors: { 'fields.title': ['Слишком длинное название'] },
            recovery: 'correct_fields',
          },
          meta: { requestId: 'request-validation', contractVersion: '1.0' },
        },
        422,
      ),
    );
    const api = createSanaClient({ fetch: fetcher });
    await expect(
      api.saveDraft('task-1', { expectedVersion: 1, fields: { title: 'Кафе' } }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'Проверьте поля',
      requestId: 'request-validation',
      fieldErrors: { 'fields.title': ['Слишком длинное название'] },
      recovery: 'correct_fields',
    });
    fetcher.mockResolvedValueOnce(
      reply(
        {
          error: { code: 'STALE_VERSION', message: 'Обновите экран', fieldErrors: {}, recovery: 'refetch' },
          meta: { requestId: 'request-stale', contractVersion: '1.0' },
        },
        409,
      ),
    );
    await expect(api.confirmTask('task-1', { expectedVersion: 1 })).rejects.toMatchObject({
      status: 409,
      code: 'STALE_VERSION',
      recovery: 'refetch',
    });
  });

  it('handles non-JSON failures and rejects malformed success envelopes', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('<h1>Gateway unavailable</h1>', { status: 502, headers: { 'X-Request-Id': 'proxy-1' } }),
      )
      .mockResolvedValueOnce(reply({ success: true }));
    const api = createSanaClient({ fetch: fetcher });
    await expect(api.health()).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
      requestId: 'proxy-1',
    });
    await expect(api.health()).rejects.toMatchObject({ status: 200, code: 'INVALID_RESPONSE' });
  });

  it('preserves cancellation while reading the response body and its creation retry key', async () => {
    const response = reply(envelope({ screen: 'task-workspace' }), 201);
    const aborted = new DOMException('The operation was aborted.', 'AbortError');
    vi.spyOn(response, 'json').mockRejectedValueOnce(aborted);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
    const api = createSanaClient({ fetch: fetcher });
    await expect(
      api.startTask({ rawDescription: 'Кафе' }, { idempotencyKey: 'cancelled-creation-123' }),
    ).rejects.toMatchObject({
      status: 0,
      code: 'REQUEST_ABORTED',
      recovery: null,
      idempotencyKey: 'cancelled-creation-123',
      cause: aborted,
    });
  });

  it('has no runtime imports of server or database modules', () => {
    const source = readFileSync(new URL('../client/index.ts', import.meta.url), 'utf8');
    expect(source.match(/^import(?!\s+type\b).*$/gm)).toBeNull();
    expect(source).not.toContain('localStorage');
  });

  it('maps every client journey to the documented HTTP operation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(envelope({})));
    const api = createSanaClient({ fetch: fetcher });
    const version = { expectedVersion: 2 };
    const calls: { method: string; path: string; invoke: () => Promise<unknown> }[] = [
      { method: 'GET', path: '/health', invoke: () => api.health() },
      { method: 'GET', path: '/bootstrap', invoke: () => api.bootstrap() },
      { method: 'POST', path: '/session/start', invoke: () => api.startSession({ code: 'demo-code' }) },
      { method: 'POST', path: '/session/end', invoke: () => api.endSession() },
      { method: 'POST', path: '/teams/start', invoke: () => api.createTeam({ name: 'Команда' }) },
      { method: 'GET', path: '/catalog', invoke: () => api.catalog() },
      { method: 'GET', path: '/dashboard', invoke: () => api.dashboard() },
      { method: 'GET', path: '/scoreboard', invoke: () => api.scoreboard() },
      { method: 'GET', path: '/snapshot', invoke: () => api.snapshot() },
      {
        method: 'POST',
        path: '/tasks/start',
        invoke: () => api.startTask({ rawDescription: 'Задача кафе' }),
      },
      { method: 'GET', path: '/tasks/task-1', invoke: () => api.task('task-1') },
      { method: 'GET', path: '/tasks/task-1/workspace', invoke: () => api.workspace('task-1') },
      { method: 'GET', path: '/tasks/task-1/review', invoke: () => api.reviewDesk('task-1') },
      {
        method: 'POST',
        path: '/tasks/task-1/draft',
        invoke: () => api.saveDraft('task-1', { ...version, fields: { title: 'Кафе' } }),
      },
      {
        method: 'POST',
        path: '/tasks/task-1/answers',
        invoke: () =>
          api.applyAnswers('task-1', { ...version, answers: [{ field: 'noConstraints', value: true }] }),
      },
      { method: 'POST', path: '/tasks/task-1/clarify', invoke: () => api.clarifyTask('task-1', version) },
      { method: 'POST', path: '/tasks/task-1/confirm', invoke: () => api.confirmTask('task-1', version) },
      { method: 'POST', path: '/tasks/task-1/publish', invoke: () => api.publishTask('task-1', version) },
      {
        method: 'POST',
        path: '/tasks/task-1/proposals',
        invoke: () =>
          api.propose('task-1', {
            idea: 'Прогноз',
            plan: 'Пилот',
            estimatedTime: 'Неделя',
            prototypeUrl: 'https://example.test',
          }),
      },
      {
        method: 'POST',
        path: '/proposals/proposal-1/decision',
        invoke: () => api.decideProposal('proposal-1', { ...version, decision: 'select' }),
      },
      {
        method: 'POST',
        path: '/tasks/task-1/milestones',
        invoke: () => api.createMilestone('task-1', { title: 'Пилот', acceptanceCriteria: 'CSV' }),
      },
      { method: 'GET', path: '/milestones/milestone-1', invoke: () => api.milestone('milestone-1') },
      {
        method: 'POST',
        path: '/milestones/milestone-1/evidence',
        invoke: () =>
          api.submitEvidence('milestone-1', {
            ...version,
            evidenceUrl: 'https://github.com/openai/openai-node',
            description: 'Прототип',
          }),
      },
      {
        method: 'POST',
        path: '/milestones/milestone-1/decision',
        invoke: () =>
          api.decideMilestone('milestone-1', { ...version, decision: 'return', feedback: 'Добавьте CSV' }),
      },
    ];
    for (const call of calls) {
      await call.invoke();
      const [url, init] = fetcher.mock.calls.at(-1)!;
      expect(url).toBe(`/api/v1${call.path}`);
      expect(init!.method).toBe(call.method);
      const template = call.path.replace(/\/(task|proposal|milestone)-1(?=\/|$)/g, '/{id}');
      expect(openApiDocument.paths[template]?.[call.method.toLowerCase() as 'get' | 'post']).toBeDefined();
    }
    expect(calls).toHaveLength(
      Object.values(openApiDocument.paths).reduce((sum, methods) => sum + Object.keys(methods).length, 0),
    );
    expect(new Headers(fetcher.mock.calls[4]![1]!.headers).has('Idempotency-Key')).toBe(false);
  });

  it('works against real HTTP: role login, private drafts, conflict recovery and logout', async () => {
    const store = new Store();
    const runtime = createApp({
      store,
      ai: createAiProvider({ mode: 'stub' }),
      git: createGitProvider({ mode: 'mock' }),
      rateLimit: false,
    });
    runtime.auth.addUser(
      { id: 'owner', role: 'business', displayName: 'Кафе', teamId: null },
      'owner-contract-code',
    );
    try {
      runtime.httpServer.listen(0, '127.0.0.1');
      await once(runtime.httpServer, 'listening');
      const address = runtime.httpServer.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
      let token: string | null = null;
      const api = createSanaClient({ baseUrl, getToken: () => token });
      const guest = createSanaClient({ baseUrl });
      expect((await guest.snapshot()).data.dashboard).toBeNull();
      await expect(api.dashboard()).rejects.toMatchObject({ status: 401, code: 'LOGIN_REQUIRED' });
      token = (await api.startSession({ code: 'owner-contract-code' })).data.token;
      expect((await api.dashboard()).data.screen).toBe('business-dashboard');
      const input = { rawDescription: 'Снизить списания кафе', title: 'Кафе', industry: 'Общепит' };
      const started = await api.startTask(input, { idempotencyKey: 'contract-retry-123' });
      const replay = await api.startTask(input, { idempotencyKey: 'contract-retry-123' });
      expect(replay.data.task.id).toBe(started.data.task.id);
      expect(started.feedback?.kind).toBe('success');
      await expect(guest.task(started.data.task.id)).rejects.toMatchObject({
        status: 404,
        code: 'TASK_NOT_FOUND',
      });
      const saved = await api.saveDraft(started.data.task.id, {
        expectedVersion: started.data.task.version,
        fields: { need: 'Прогнозировать закупки' },
      });
      expect(saved.data.draft.fields.need).toBe('Прогнозировать закупки');
      await expect(
        api.confirmTask(started.data.task.id, { expectedVersion: started.data.task.version }),
      ).rejects.toMatchObject({ status: 409, code: 'STALE_VERSION', recovery: 'refetch' });
      await api.endSession();
      await expect(api.bootstrap()).rejects.toMatchObject({
        status: 401,
        code: 'SESSION_EXPIRED',
        recovery: 'sign_in',
      });
    } finally {
      await runtime.close();
      store.close();
    }
  });
});

describe('OpenAPI contract', () => {
  it('covers every app API route and has unique operation IDs', () => {
    const source = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    const routes = [...source.matchAll(/api\.(get|post)\('([^']+)'/g)]
      .map(([, method, path]) => `${method!.toUpperCase()} ${path!.replace(/:id/g, '{id}')}`)
      .sort();
    const documented = Object.entries(openApiDocument.paths)
      .flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
      )
      .sort();
    expect(documented).toEqual(routes);
    expect(openApiDocument.openapi).toBe('3.1.0');
    expect(openApiDocument.servers).toEqual([{ url: '/api/v1' }]);
    const ids = Object.values(openApiDocument.paths).flatMap((operations) =>
      Object.values(operations).map((operation) => operation.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('derives request schemas from live validators in input mode, preserving optional defaults', () => {
    for (const [name, schema] of Object.entries(commands)) {
      if (name !== 'catalog')
        expect(openApiDocument.components.schemas[`${name}Input`]).toEqual(
          z.toJSONSchema(schema, { io: 'input' }),
        );
    }
    const schemas = openApiDocument.components.schemas;
    expect(schemas.decisionInput!.required).toEqual(['expectedVersion', 'decision']);
    expect(schemas.createTeamInput!.required).toEqual(['name']);
    expect(schemas.draftInput!.additionalProperties).toBe(false);
  });

  it('documents roles, optional guest authentication, typed pagination and retry keys', () => {
    expect(openApiDocument.paths['/dashboard']!.get!.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/catalog']!.get!.security).toEqual([{}, { bearerAuth: [] }]);
    expect(openApiDocument.paths['/tasks/start']!.post!.description).toContain('business');
    expect(openApiDocument.paths['/tasks/{id}/proposals']!.post!.description).toContain('team');
    const pagination = openApiDocument.paths['/catalog']!.get!.parameters!.find(
      (parameter) => parameter.name === 'pageSize',
    );
    expect(pagination?.schema).toMatchObject({ type: 'integer', minimum: 1, maximum: 50, default: 12 });
    expect(openApiDocument.paths['/tasks/start']!.post!.parameters).toContainEqual(
      expect.objectContaining({ name: 'Idempotency-Key', in: 'header' }),
    );
    expect(openApiDocument.paths['/milestones/{id}/decision']!.post!.responses['200']).toBeDefined();
  });

  it('resolves every local response and request schema reference', () => {
    const references = [
      ...JSON.stringify(openApiDocument).matchAll(/"\$ref":"#\/components\/schemas\/([^"#]+)"/g),
    ];
    expect(references.length).toBeGreaterThan(24);
    for (const [, name] of references) expect(openApiDocument.components.schemas[name!]).toBeDefined();
  });

  it('maps dashboard screen values explicitly to their matching schemas', () => {
    expect(openApiDocument.components.schemas.DashboardView).toMatchObject({
      discriminator: {
        propertyName: 'screen',
        mapping: {
          'business-dashboard': '#/components/schemas/BusinessDashboardView',
          'team-dashboard': '#/components/schemas/TeamDashboardView',
        },
      },
    });
  });
});
