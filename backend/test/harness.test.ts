import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAiProvider } from '../src/integrations/ai.js';
import { createGitProvider } from '../src/integrations/git.js';
import { emptyFields, type AiProvider } from '../src/contracts.js';
import { checkQuality } from '../src/domain/quality.js';
import { Store } from '../src/db.js';
import { Auth } from '../src/auth.js';
import { Tasks } from '../src/services/tasks.js';
import { Views } from '../src/views.js';
import { createApp } from '../src/app.js';

const rawDescription = 'Пользователи: менеджеры кафе. Источник данных: CSV продаж. Нужен прогноз закупок.';
const aiInput = { rawDescription, fields: emptyFields() };
function response(value: unknown) {
  return new Response(
    JSON.stringify({
      id: 'resp_test',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: 'gpt-6-luna',
      usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 },
      output: [
        {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }],
        },
      ],
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
const selections = {
  suggestions: [
    { field: 'users', quote: 'менеджеры кафе' },
    { field: 'dataSource', quote: 'CSV продаж' },
  ],
};
const provider = (value: unknown = selections) =>
  createAiProvider({ apiKey: 'test-key', fetch: async () => response(value) });

describe('grounded AI harness', () => {
  it('uses Luna and saves safe per-call telemetry with validated exact quotes', async () => {
    let body: any;
    const ai = createAiProvider({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return response(selections);
      },
    });
    const result = await ai.analyze(aiInput);
    expect(result.mode).toBe('openai');
    expect(result.suggestions[0]).toMatchObject({
      field: 'users',
      value: 'менеджеры кафе',
      source: { id: 'rawDescription', quote: 'менеджеры кафе' },
    });
    expect(body).toMatchObject({
      model: 'gpt-6-luna',
      reasoning: { effort: 'low' },
      store: false,
      max_output_tokens: 4096,
    });
    expect(result.run).toMatchObject({
      operation: 'analyze',
      validation: 'passed',
      outcome: 'completed',
      inputTokens: 120,
      outputTokens: 40,
    });
    expect(JSON.stringify(result.run)).not.toContain(rawDescription);
  });
  it.each([
    { suggestions: [{ field: 'users', quote: '400 сотрудников' }] },
    {
      suggestions: [
        { field: 'users', quote: 'менеджеры кафе' },
        { field: 'users', quote: 'менеджеры кафе' },
      ],
    },
    { suggestions: [{ field: 'noConstraints', quote: 'нет ограничений' }] },
  ])('falls back on invented, duplicate or non-text facts', async (value) => {
    const result = await provider(value).analyze(aiInput);
    expect(result.suggestions).toEqual([]);
    expect(result.run).toMatchObject({
      outcome: 'fallback',
      fallbackReason: 'invalid_output',
      validation: 'failed',
    });
  });
  it('cannot replace a human field even with a valid source quote', async () => {
    const result = await provider().analyze({ ...aiInput, fields: { ...emptyFields(), users: 'Мой текст' } });
    expect(result.mode).toBe('stub');
    expect(result.suggestions).toEqual([]);
  });
  it('classifies a timeout and never stores raw provider errors', async () => {
    const ai = createAiProvider({ apiKey: 'test-key', timeoutMs: 10, fetch: () => new Promise(() => {}) });
    const result = await ai.analyze(aiInput);
    expect(result.run?.fallbackReason).toBe('timeout');
    const failed = await createAiProvider({
      apiKey: 'test-key',
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: 'secret-provider-detail' } }), { status: 429 }),
    }).analyze(aiInput);
    expect(failed.run?.fallbackReason).toBe('rate_limit');
    expect(JSON.stringify(failed)).not.toContain('secret-provider-detail');
  });
  it('removes unsupported proper nouns from otherwise valid questions', async () => {
    const result = await provider({
      missingFields: ['users', 'expectedResult', 'acceptanceCriteria'],
      questions: [
        { field: 'users', text: 'Какие сотрудники работают с уже внедрённой системой SAP?' },
        { field: 'expectedResult', text: 'Какой результат нужен?' },
        { field: 'acceptanceCriteria', text: 'Как проверить результат?' },
      ],
    }).clarify({ ...aiInput, missingFields: ['users', 'expectedResult', 'acceptanceCriteria'] });
    expect(result.mode).toBe('openai');
    expect(result.questions[0]?.text).not.toMatch(/SAP|внедрён/);
  });
  it('grounds criterion citations and never returns an acceptance decision', async () => {
    const input = {
      title: 'Этап',
      acceptanceCriteria: 'Запустить сервер\nПоказать прогноз',
      description: 'Готово',
      evidence: {
        provider: 'github' as const,
        status: 'verified' as const,
        url: 'https://github.com/a/b',
        title: 'b',
        summary: '',
        facts: [],
        warning: null,
        snapshot: {
          commitSha: 'a'.repeat(40),
          inspectedAt: new Date().toISOString(),
          coverage: 'partial' as const,
          warnings: [],
          files: [
            {
              id: 'readme',
              path: 'README.md',
              kind: 'readme' as const,
              sourceUrl: `https://github.com/a/b/blob/${'a'.repeat(40)}/README.md`,
              content: 'Run npm start to start the server.',
              truncated: false,
            },
          ],
        },
      },
    };
    const valid = await provider({
      factIndexes: [],
      checkIds: ['acceptanceCriteria'],
      criterionMatches: [
        { criterionIndex: 0, citations: [{ materialId: 'readme', quote: 'npm start' }] },
        { criterionIndex: 1, citations: [] },
      ],
    }).reviewEvidence(input);
    expect(valid.criterionEvidence?.map((item) => item.status)).toEqual([
      'materials_found',
      'insufficient_evidence',
    ]);
    expect(valid.criterionEvidence?.[0]?.citations[0]?.sourceUrl).toContain('a'.repeat(40));
    expect(valid).not.toHaveProperty('approved');
    const invalid = await provider({
      factIndexes: [],
      checkIds: ['acceptanceCriteria'],
      criterionMatches: [{ criterionIndex: 0, citations: [{ materialId: 'readme', quote: 'Tests passed' }] }],
    }).reviewEvidence(input);
    expect(invalid.mode).toBe('stub');
    expect(invalid.criterionEvidence?.every((item) => item.citations.length === 0)).toBe(true);
    expect(invalid.criterionEvidence?.every((item) => item.status === 'not_assessed')).toBe(true);
    const limited = await provider({
      factIndexes: [],
      checkIds: ['acceptanceCriteria'],
      criterionMatches: [{ criterionIndex: 0, citations: [] }],
    }).reviewEvidence({
      ...input,
      acceptanceCriteria: Array.from({ length: 13 }, (_, i) => `Критерий ${i + 1}`).join('\n'),
    });
    expect(limited.criterionEvidence?.[12]).toMatchObject({
      criterion: 'Критерий 13',
      status: 'not_assessed',
      nextStep: expect.stringContaining('до 12'),
    });
  });
});

describe('analysis UX and optimistic application', () => {
  const stores: Store[] = [];
  afterEach(() => stores.splice(0).forEach((store) => store.close()));
  function setup(ai: AiProvider = provider()) {
    const store = new Store();
    stores.push(store);
    const auth = new Auth(store);
    const actor = { id: 'business', role: 'business' as const, displayName: 'Кафе', teamId: null };
    auth.addUser(actor, 'business-code');
    const tasks = new Tasks(store, ai, () => {});
    const task = tasks.start(actor, { rawDescription });
    return { store, auth, actor, tasks, task, views: new Views(store, tasks) };
  }
  it('offers review, applies selected facts once and consumes rejected suggestions', async () => {
    const { tasks, actor, task, views } = setup();
    const analyzed = await tasks.analyze(actor, task.id, task.version);
    expect(views.workspace(task.id, actor).nextAction.id).toBe('review_suggestions');
    expect(analyzed.draftFields.users).toBe('');
    const input = {
      expectedVersion: analyzed.version,
      analysisId: analyzed.analysis!.id,
      suggestionIds: [analyzed.analysis!.suggestions[0]!.id],
    };
    const applied = tasks.applySuggestions(actor, task.id, input);
    expect(applied.draftFields).toMatchObject({ users: 'менеджеры кафе', dataSource: '' });
    expect(applied.confirmedFields).toBeNull();
    expect(views.workspace(task.id, actor).analysis?.status).toBe('resolved');
    expect(() =>
      tasks.applySuggestions(actor, task.id, { ...input, expectedVersion: applied.version }),
    ).toThrow(/предыдущей версии/);
  });
  it('dismisses all suggestions without changing facts', async () => {
    const { tasks, actor, task, views } = setup();
    const analyzed = await tasks.analyze(actor, task.id, 1);
    tasks.applySuggestions(actor, task.id, {
      expectedVersion: analyzed.version,
      analysisId: analyzed.analysis!.id,
      suggestionIds: [],
    });
    expect(views.workspace(task.id, actor).nextAction.id).toBe('clarify');
    expect(tasks.require(task.id).draftFields.users).toBe('');
  });
  it('counts approved suggestions as answers in an existing clarification session', async () => {
    const ai = provider();
    const stub = createAiProvider({ mode: 'stub' });
    const { tasks, actor, task, views } = setup({
      analyze: ai.analyze.bind(ai),
      clarify: stub.clarify.bind(stub),
      reviewEvidence: ai.reviewEvidence.bind(ai),
    });
    const clarified = await tasks.clarify(actor, task.id, task.version);
    expect(clarified.clarification?.questions.some((q) => q.field === 'dataSource')).toBe(true);
    const analyzed = await tasks.analyze(actor, task.id, clarified.version);
    tasks.applySuggestions(actor, task.id, {
      expectedVersion: analyzed.version,
      analysisId: analyzed.analysis!.id,
      suggestionIds: analyzed.analysis!.suggestions.map((s) => s.id),
    });
    expect(
      views.workspace(task.id, actor).clarification?.questions.find((q) => q.field === 'dataSource')
        ?.answered,
    ).toBe(true);
  });
  it('refuses old proposals after a manual edit, retaining the user text', async () => {
    const { tasks, actor, task, views } = setup();
    const analyzed = await tasks.analyze(actor, task.id, 1);
    const edited = tasks.draft(actor, task.id, {
      expectedVersion: analyzed.version,
      fields: { users: 'Администратор' },
    });
    expect(views.workspace(task.id, actor).analysis?.status).toBe('stale');
    expect(() =>
      tasks.applySuggestions(actor, task.id, {
        expectedVersion: edited.version,
        analysisId: analyzed.analysis!.id,
        suggestionIds: analyzed.analysis!.suggestions.map((s) => s.id),
      }),
    ).toThrow(/предыдущей версии/);
    expect(tasks.require(task.id).draftFields.users).toBe('Администратор');
  });
  it('logs a completed stale run despite the rejected result transaction', async () => {
    const base = provider();
    let resolve!: () => void;
    const waiting = new Promise<void>((r) => {
      resolve = r;
    });
    const ai: AiProvider = {
      analyze: async (input) => {
        await waiting;
        return base.analyze(input);
      },
      clarify: base.clarify.bind(base),
      reviewEvidence: base.reviewEvidence.bind(base),
    };
    const { tasks, actor, task, store } = setup(ai);
    const pending = tasks.analyze(actor, task.id, 1);
    tasks.draft(actor, task.id, { expectedVersion: 1, fields: { users: 'Владелец' } });
    resolve();
    await expect(pending).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(store.aiRuns(task.id)[0]).toMatchObject({
      disposition: 'stale',
      sourceVersion: 1,
      operation: 'analyze',
    });
    expect(tasks.require(task.id).analysis).toBeUndefined();
  });
  it('keeps run history private and exposes the analyze/apply HTTP workflow', async () => {
    const { store, auth, actor, task } = setup();
    auth.addUser({ ...actor, id: 'other' }, 'other-code');
    const runtime = createApp({
      store,
      ai: provider(),
      git: createGitProvider({ mode: 'mock' }),
      rateLimit: false,
    });
    try {
      const token = auth.login('business-code').token;
      const otherToken = auth.login('other-code').token;
      const res = await request(runtime.app)
        .post(`/api/v1/tasks/${task.id}/analyze`)
        .auth(token, { type: 'bearer' })
        .send({ expectedVersion: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.aiRuns).toHaveLength(1);
      const denied = await request(runtime.app)
        .get(`/api/v1/tasks/${task.id}/workspace`)
        .auth(otherToken, { type: 'bearer' });
      expect(denied.status).toBe(403);
      const apply = await request(runtime.app)
        .post(`/api/v1/tasks/${task.id}/suggestions/apply`)
        .auth(token, { type: 'bearer' })
        .send({
          expectedVersion: res.body.data.task.version,
          analysisId: res.body.data.analysis.id,
          suggestionIds: [],
        });
      expect(apply.status).toBe(200);
      expect(apply.body.data.analysis.status).toBe('resolved');
    } finally {
      await runtime.close();
    }
  });
});

it('flags vague and contradictory content separately from readiness points', () => {
  const quality = checkQuality({
    ...emptyFields(),
    need: 'Сделать лучше',
    users: 'Сделать лучше',
    expectedResult: 'Сделать лучше',
    dataAvailability: 'none',
    dataSource: 'CSV',
    noConstraints: true,
    constraints: 'Неделя',
  });
  expect(quality.warnings.map((w) => w.id)).toEqual(
    expect.arrayContaining(['vague:need', 'repeated:need', 'conflict:data', 'conflict:constraints']),
  );
  expect(quality.nextAction?.field).toBe('need');
});
