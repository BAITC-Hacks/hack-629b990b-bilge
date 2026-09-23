import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../src/app.js';
import { Auth } from '../src/auth.js';
import { Store } from '../src/db.js';
import { Tasks } from '../src/services/tasks.js';
import { emptyFields, type AiProvider, type GitProvider } from '../src/contracts.js';

export const fakeAi: AiProvider = {
  async analyze() {
    return { suggestions: [], mode: 'stub', warning: null };
  },
  async clarify({ missingFields }) {
    return {
      mode: 'stub',
      warning: null,
      missingFields,
      questions: [
        { field: 'dataSource', text: 'Какие данные о продажах доступны?' },
        { field: 'expectedResult', text: 'Какой результат ожидается от команды?' },
        { field: 'acceptanceCriteria', text: 'Как вы будете принимать результат?' },
      ],
    };
  },
  async reviewEvidence() {
    return {
      mode: 'stub',
      warning: null,
      summary: 'Нужна проверка бизнеса',
      checks: ['Проверьте критерий приёмки'],
    };
  },
};
export const fakeGit: GitProvider = {
  async inspect(url) {
    return {
      provider: 'mock',
      status: 'mock',
      url,
      title: 'Demo',
      summary: 'Тестовые материалы',
      facts: [],
      warning: 'Мок',
    };
  },
};
const complete = {
  ...emptyFields(),
  title: 'Снижение списаний кафе',
  industry: 'Общепит',
  context: 'В кафе много непроданной еды',
  need: 'Уменьшить списания',
  users: 'Менеджеры кафе',
  dataAvailability: 'available',
  dataSource: 'CSV продаж за три месяца',
  expectedResult: 'Прототип прогноза закупок',
  acceptanceCriteria: 'Загрузить CSV и показать прогноз по каждому блюду',
  constraints: 'Две недели, без персональных данных',
  contact: 'cafe@example.test',
  interactionFormat: 'Две консультации в неделю',
};

describe('BFF task and team journeys', () => {
  let store: Store;
  let runtime: ReturnType<typeof createApp>;
  let business: string;
  let other: string;
  let team1: string;
  let team2: string;
  beforeEach(() => {
    store = new Store();
    const auth = new Auth(store);
    for (const n of [1, 2]) {
      store.saveTeam({
        id: `team${n}`,
        name: `Команда ${n}`,
        interests: [],
        skills: [],
        technologies: [],
        avatarPreset: 'robot',
        color: '#123456',
        confirmedPoints: 0,
      });
      auth.addUser(
        { id: `student${n}`, role: 'team', displayName: `Команда ${n}`, teamId: `team${n}` },
        `team-code-${n}`,
      );
    }
    auth.addUser({ id: 'business', role: 'business', displayName: 'Кафе', teamId: null }, 'business-code');
    auth.addUser({ id: 'other', role: 'business', displayName: 'Другой бизнес', teamId: null }, 'other-code');
    business = auth.login('business-code').token;
    other = auth.login('other-code').token;
    team1 = auth.login('team-code-1').token;
    team2 = auth.login('team-code-2').token;
    runtime = createApp({ store, ai: fakeAi, git: fakeGit, allowedOrigins: ['http://localhost:5173'] });
  });
  afterEach(async () => {
    await runtime.close();
    store.close();
  });
  const post = (token: string, path: string, body: object) =>
    request(runtime.app).post(`/api/v1${path}`).auth(token, { type: 'bearer' }).send(body);
  async function published() {
    const start = await post(business, '/tasks/start', {
      rawDescription: 'В кафе много непроданной еды',
      industry: 'Общепит',
    });
    expect(start.status).toBe(201);
    const id = start.body.data.task.id;
    expect(start.body.data.nextAction.id).toBe('analyze');
    const save = await post(business, `/tasks/${id}/draft`, {
      expectedVersion: start.body.data.task.version,
      fields: complete,
    });
    const confirm = await post(business, `/tasks/${id}/confirm`, {
      expectedVersion: save.body.data.task.version,
    });
    expect(confirm.body.data.officialScore.value).toBe(100);
    const publish = await post(business, `/tasks/${id}/publish`, {
      expectedVersion: confirm.body.data.task.version,
    });
    expect(publish.status).toBe(200);
    return publish.body.data;
  }
  it('walks from cafe input through clarifications and preserves the official snapshot during edits', async () => {
    const start = await post(business, '/tasks/start', {
      rawDescription: 'В кафе много непроданной еды',
      industry: 'Общепит',
    });
    expect(start.status).toBe(201);
    const id = start.body.data.task.id;
    const clarify = await post(business, `/tasks/${id}/clarify`, {
      expectedVersion: start.body.data.task.version,
    });
    expect(clarify.body.data.clarification.questions).toHaveLength(3);
    expect((await request(runtime.app).get(`/api/v1/tasks/${id}`)).status).toBe(404);
    const answers = await post(business, `/tasks/${id}/answers`, {
      expectedVersion: clarify.body.data.task.version,
      answers: [{ field: 'expectedResult', value: 'Прототип прогноза' }],
    });
    expect(answers.body.data.draft.fields.expectedResult).toBe('Прототип прогноза');
    const card = await published();
    const edit = await post(business, `/tasks/${card.task.id}/draft`, {
      expectedVersion: card.task.version,
      fields: { title: 'Секретное название', acceptanceCriteria: '' },
    });
    expect(edit.body.data.officialScore.value).toBe(100);
    expect(edit.body.data.forecast.value).toBe(85);
    const detail = await request(runtime.app).get(`/api/v1/tasks/${card.task.id}`);
    expect(detail.body.data.card.fields.title).toBe(complete.title);
    expect(JSON.stringify(detail.body)).not.toContain('Секретное название');
    const confirm = await post(business, `/tasks/${card.task.id}/confirm`, {
      expectedVersion: edit.body.data.task.version,
    });
    expect(confirm.body.data.officialScore.value).toBe(85);
    expect(
      (await request(runtime.app).get(`/api/v1/tasks/${card.task.id}`)).body.data.card.fields.title,
    ).toBe('Секретное название');
  });
  it('resumes questions one by one after a reload and keeps saved answers editable', async () => {
    const start = await post(business, '/tasks/start', {
      rawDescription: 'Списания кафе',
      industry: 'Общепит',
    });
    const id = start.body.data.task.id;
    let response = await post(business, `/tasks/${id}/clarify`, { expectedVersion: 1 });
    expect(response.body.data.clarification.nextQuestion.field).toBe('dataSource');
    expect(response.body.data.steps.find((step: { id: string }) => step.id === 'clarify').complete).toBe(
      false,
    );
    response = await post(business, `/tasks/${id}/answers`, {
      expectedVersion: response.body.data.task.version,
      answers: [{ field: 'dataSource', value: 'CSV продаж' }],
    });
    expect(response.body.data.clarification.questions).toHaveLength(3);
    const reload = await request(runtime.app)
      .get(`/api/v1/tasks/${id}/workspace`)
      .auth(business, { type: 'bearer' });
    expect(reload.body.data.clarification.progress).toEqual({
      total: 3,
      answered: 1,
      skipped: 0,
      remaining: 2,
    });
    expect(reload.body.data.clarification.questions[0]).toMatchObject({
      answered: true,
      value: 'CSV продаж',
    });
    expect(reload.body.data.clarification.nextQuestion.field).toBe('expectedResult');
    expect(reload.body.data.nextAction.id).toBe('answer_question');
    response = await post(business, `/tasks/${id}/draft`, {
      expectedVersion: reload.body.data.task.version,
      fields: { title: 'Сократить списания' },
    });
    expect(response.body.data.clarification.progress.remaining).toBe(2);
    response = await post(business, `/tasks/${id}/answers`, {
      expectedVersion: response.body.data.task.version,
      answers: [
        { field: 'expectedResult', value: 'Прототип прогноза' },
        { field: 'acceptanceCriteria', value: 'Показать прогноз по CSV' },
      ],
    });
    expect(response.body.data.clarification.nextQuestion).toBeNull();
    expect(response.body.data.nextAction.id).toBe('confirm');
    expect(response.body.data.steps.find((step: { id: string }) => step.id === 'clarify').complete).toBe(
      true,
    );
    response = await post(business, `/tasks/${id}/draft`, {
      expectedVersion: response.body.data.task.version,
      fields: { expectedResult: '' },
    });
    expect(response.body.data.clarification.nextQuestion.field).toBe('expectedResult');
  });
  it('skips irrelevant questions without erasing them and permits publishing partial answers', async () => {
    const start = await post(business, '/tasks/start', {
      rawDescription: 'Списания кафе',
      industry: 'Общепит',
    });
    const id = start.body.data.task.id;
    let response = await post(business, `/tasks/${id}/clarify`, { expectedVersion: 1 });
    response = await post(business, `/tasks/${id}/answers`, {
      expectedVersion: response.body.data.task.version,
      answers: [{ field: 'dataAvailability', value: 'none' }],
    });
    expect(response.body.data.clarification.questions[0]).toMatchObject({
      field: 'dataSource',
      skipped: true,
    });
    expect(response.body.data.clarification.progress).toEqual({
      total: 3,
      answered: 0,
      skipped: 1,
      remaining: 2,
    });
    expect(response.body.data.clarification.nextQuestion.field).toBe('expectedResult');
    response = await post(business, `/tasks/${id}/answers`, {
      expectedVersion: response.body.data.task.version,
      answers: [{ field: 'dataAvailability', value: 'available' }],
    });
    expect(response.body.data.clarification.nextQuestion.field).toBe('dataSource');
    response = await post(business, `/tasks/${id}/confirm`, {
      expectedVersion: response.body.data.task.version,
    });
    expect(response.body.data.nextAction.id).toBe('publish');
  });
  it('opens a fresh clarification on a confirmed card until the owner reviews it again', async () => {
    const workspace = await published();
    const id = workspace.task.id;
    const questions = await post(business, `/tasks/${id}/clarify`, {
      expectedVersion: workspace.task.version,
    });
    expect(questions.body.data.clarification.progress.remaining).toBeGreaterThan(0);
    expect(questions.body.data.nextAction.id).toBe('answer_question');
    expect(questions.body.data.clarification.reviewed).toBe(false);
    const confirmed = await post(business, `/tasks/${id}/confirm`, {
      expectedVersion: questions.body.data.task.version,
    });
    expect(confirmed.body.data.nextAction.id).toBe('review');
    expect(confirmed.body.data.clarification.reviewed).toBe(true);
  });
  it('accepts a metric and target instead of asking again for an alternative acceptance condition', async () => {
    const start = await post(business, '/tasks/start', {
      rawDescription: 'Списания кафе',
      industry: 'Общепит',
    });
    const id = start.body.data.task.id;
    const questions = await post(business, `/tasks/${id}/clarify`, { expectedVersion: 1 });
    const response = await post(business, `/tasks/${id}/draft`, {
      expectedVersion: questions.body.data.task.version,
      fields: {
        dataSource: 'CSV продаж',
        expectedResult: 'Прототип',
        successMetric: 'MAE',
        successTarget: '5',
      },
    });
    expect(response.body.data.clarification.questions[2]).toMatchObject({
      field: 'acceptanceCriteria',
      skipped: true,
    });
    expect(response.body.data.clarification.nextQuestion).toBeNull();
    expect(response.body.data.nextAction.id).toBe('confirm');
    const removed = await post(business, `/tasks/${id}/draft`, {
      expectedVersion: response.body.data.task.version,
      fields: { successTarget: '' },
    });
    expect(removed.body.data.clarification.nextQuestion.field).toBe('acceptanceCriteria');
  });
  it('allows two selected teams, evidence review, and exactly one award on retry', async () => {
    const card = await published();
    const id = card.task.id;
    for (const token of [team1, team2]) {
      const response = await post(token, `/tasks/${id}/proposals`, {
        idea: 'Прогноз спроса',
        plan: 'Изучим данные и сравним модели',
        estimatedTime: '2 недели',
        prototypeUrl: 'https://example.com/demo',
      });
      expect(response.status).toBe(201);
    }
    const desk = await request(runtime.app)
      .get(`/api/v1/tasks/${id}/review`)
      .auth(business, { type: 'bearer' });
    expect(desk.body.data.proposals).toHaveLength(2);
    for (const p of desk.body.data.proposals) {
      const res = await post(business, `/proposals/${p.id}/decision`, {
        expectedVersion: p.version,
        decision: 'select',
      });
      expect(res.status).toBe(200);
    }
    const phase = await post(team1, `/tasks/${id}/milestones`, {
      title: 'Проверить прогноз',
      acceptanceCriteria: 'Показать прогноз по тестовому CSV',
    });
    expect(phase.status).toBe(201);
    const m = phase.body.data.milestone;
    const submitted = await post(team1, `/milestones/${m.id}/evidence`, {
      expectedVersion: m.version,
      evidenceUrl: 'https://github.com/openai/openai-node',
      description: 'Добавили демонстрацию прогноза',
    });
    expect(submitted.body.data.milestone.status).toBe('in_review');
    expect(submitted.body.data.milestone.statusLabel).toBe('На проверке');
    const waiting = await request(runtime.app).get('/api/v1/catalog');
    expect(waiting.body.data.world.stations[0]).toMatchObject({
      pendingMilestones: 1,
      approvedMilestones: 0,
    });
    const publicProgress = await request(runtime.app).get(`/api/v1/tasks/${id}`);
    expect(
      publicProgress.body.data.teamProgress.find((t: { teamId: string }) => t.teamId === 'team1'),
    ).toMatchObject({ pendingStages: 1, approvedStages: 0, status: 'in_review', statusLabel: 'На проверке' });
    expect(JSON.stringify(publicProgress.body)).not.toContain('Добавили демонстрацию прогноза');
    expect(JSON.stringify(publicProgress.body)).not.toContain('https://github.com/openai/openai-node');
    expect(submitted.body.data.milestone.actions[0].enabled).toBe(false);
    expect(
      (
        await post(team1, `/milestones/${m.id}/evidence`, {
          expectedVersion: submitted.body.data.milestone.version,
          evidenceUrl: 'https://example.com/new',
          description: 'Замена во время проверки',
        })
      ).status,
    ).toBe(409);
    expect(store.points('team1')).toBe(0);
    const returned = await post(business, `/milestones/${m.id}/decision`, {
      expectedVersion: submitted.body.data.milestone.version,
      decision: 'return',
      feedback: 'Добавьте пример проверки на CSV',
    });
    expect(returned.body.data.milestone.status).toBe('changes_requested');
    expect(
      (await request(runtime.app).get('/api/v1/catalog')).body.data.world.stations[0].pendingMilestones,
    ).toBe(0);
    expect(store.points('team1')).toBe(0);
    const revised = await post(team1, `/milestones/${m.id}/evidence`, {
      expectedVersion: returned.body.data.milestone.version,
      evidenceUrl: 'https://github.com/openai/openai-node',
      description: 'Добавлен пример проверки на CSV',
    });
    const body = { expectedVersion: revised.body.data.milestone.version, decision: 'approve' };
    expect((await post(team1, `/milestones/${m.id}/decision`, body)).status).toBe(403);
    expect((await post(business, `/milestones/${m.id}/decision`, body)).status).toBe(200);
    expect((await post(business, `/milestones/${m.id}/decision`, body)).status).toBe(200);
    expect(store.points('team1')).toBe(10);
    expect((await request(runtime.app).get('/api/v1/catalog')).body.data.world.stations[0]).toMatchObject({
      pendingMilestones: 0,
      approvedMilestones: 1,
    });
    expect(store.points('team2')).toBe(0);
    const reviewed = await request(runtime.app)
      .get(`/api/v1/tasks/${id}/review`)
      .auth(business, { type: 'bearer' });
    const approvedProposal = reviewed.body.data.proposals.find(
      (p: { teamId: string }) => p.teamId === 'team1',
    );
    expect(approvedProposal.actions.find((a: { id: string }) => a.id === 'reject').enabled).toBe(false);
    const scores = await request(runtime.app).get('/api/v1/scoreboard');
    expect(Object.keys(scores.body.data.teams[0]).sort()).toEqual(['confirmedPoints', 'name', 'rank']);
  });
  it('keeps low readiness tasks open and implements sort and filters', async () => {
    const start = await post(business, '/tasks/start', {
      rawDescription: 'Много списаний',
      title: 'Слабая карточка',
      industry: 'Общепит',
    });
    const id = start.body.data.task.id;
    const c = await post(business, `/tasks/${id}/confirm`, { expectedVersion: start.body.data.task.version });
    await post(business, `/tasks/${id}/publish`, { expectedVersion: c.body.data.task.version });
    const high = await published();
    const catalog = await request(runtime.app).get('/api/v1/catalog');
    expect(catalog.body.data.cards.map((x: { id: string }) => x.id)).toEqual([high.task.id, id]);
    expect(catalog.body.data.world.stations).toHaveLength(2);
    const filtered = await request(runtime.app).get('/api/v1/catalog?level=draft');
    expect(filtered.body.data.cards.map((x: { id: string }) => x.id)).toEqual([id]);
    const reply = await post(team1, `/tasks/${id}/proposals`, {
      idea: 'Уточним проблему',
      plan: 'Сначала исследуем процесс',
      estimatedTime: 'Неделя',
      prototypeUrl: 'https://example.com',
    });
    expect(reply.status).toBe(201);
  });
  it('protects owner commands and rejects stale writes and invalid fields', async () => {
    const card = await published();
    const path = `/tasks/${card.task.id}/draft`;
    expect(
      (await post(other, path, { expectedVersion: card.task.version, fields: { title: 'Чужая правка' } }))
        .status,
    ).toBe(403);
    expect(
      (await post(team1, path, { expectedVersion: card.task.version, fields: { title: 'Чужая правка' } }))
        .status,
    ).toBe(403);
    expect(
      (await post(business, path, { expectedVersion: 1, fields: { title: 'Старая правка' } })).status,
    ).toBe(409);
    const invalid = await post(business, path, {
      expectedVersion: card.task.version,
      fields: { readinessScore: 100 },
    });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.fieldErrors).toBeDefined();
    const malformedUrl = await post(team1, `/tasks/${card.task.id}/proposals`, {
      idea: 'Планируем улучшение',
      plan: 'Проверим на данных',
      estimatedTime: 'Неделя',
      prototypeUrl: 'not-a-url',
    });
    expect(malformedUrl.status).toBe(422);
    expect(malformedUrl.body.error.fieldErrors.prototypeUrl).toBeDefined();
    const placeholder = await post(business, path, {
      expectedVersion: card.task.version,
      fields: { title: '...' },
    });
    expect(placeholder.body.data.actions.find((a: { id: string }) => a.id === 'confirm').enabled).toBe(false);
    expect(
      (
        await post(business, `/tasks/${card.task.id}/confirm`, {
          expectedVersion: placeholder.body.data.task.version,
        })
      ).status,
    ).toBe(422);
    expect(
      (await request(runtime.app).get(`/api/v1/tasks/${card.task.id}/review`).auth(team1, { type: 'bearer' }))
        .status,
    ).toBe(403);
  });
  it('lets the owner save while teams respond but still rejects edits from a stale editor tab', async () => {
    const workspace = await published();
    const id = workspace.task.id;
    const proposed = await post(team1, `/tasks/${id}/proposals`, {
      idea: 'Прогноз',
      plan: 'Проверим CSV',
      estimatedTime: 'Неделя',
      prototypeUrl: 'https://example.com',
    });
    expect(proposed.status).toBe(201);
    expect(proposed.body.data.card.version).toBeGreaterThan(workspace.task.version);
    const unchanged = await request(runtime.app)
      .get(`/api/v1/tasks/${id}/workspace`)
      .auth(business, { type: 'bearer' });
    expect(unchanged.body.data.task.version).toBe(workspace.task.version);
    const saved = await post(business, `/tasks/${id}/draft`, {
      expectedVersion: workspace.task.version,
      fields: { need: 'Уточнённая потребность бизнеса' },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.draft.fields.need).toBe('Уточнённая потребность бизнеса');
    const conflict = await post(business, `/tasks/${id}/draft`, {
      expectedVersion: workspace.task.version,
      fields: { need: 'Старая версия из второй вкладки' },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('STALE_VERSION');
    const proposal = proposed.body.data.myProposals[0];
    await post(business, `/proposals/${proposal.id}/decision`, { expectedVersion: 1, decision: 'select' });
    const milestone = await post(team1, `/tasks/${id}/milestones`, {
      title: 'Прототип',
      acceptanceCriteria: 'Работа с CSV',
    });
    await post(team1, `/milestones/${milestone.body.data.milestone.id}/evidence`, {
      expectedVersion: 1,
      evidenceUrl: 'https://example.com',
      description: 'Пилот выполнен',
    });
    const confirm = await post(business, `/tasks/${id}/confirm`, {
      expectedVersion: saved.body.data.task.version,
    });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.confirmedFields.need).toBe('Уточнённая потребность бизнеса');
  });
  it('does not discard an in-flight AI clarification because a proposal arrived', async () => {
    const workspace = await published();
    const id = workspace.task.id;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tasks = new Tasks(
      store,
      {
        ...fakeAi,
        async clarify(input) {
          await ready;
          return fakeAi.clarify(input);
        },
      },
      () => {},
    );
    const pending = tasks.clarify(runtime.auth.resolve(business)!, id, workspace.task.version);
    await post(team1, `/tasks/${id}/proposals`, {
      idea: 'Прогноз',
      plan: 'Проверим CSV',
      estimatedTime: 'Неделя',
      prototypeUrl: 'https://example.com',
    });
    release();
    await expect(pending).resolves.toMatchObject({ clarification: { mode: 'stub' } });
  });
  it('deduplicates retries but accepts distinct proposals from the same team', async () => {
    const card = await published();
    const body = {
      idea: 'Первая идея',
      plan: 'План работы',
      estimatedTime: 'Две недели',
      prototypeUrl: 'https://example.com',
    };
    for (let n = 0; n < 2; n++)
      expect(
        (
          await post(team1, `/tasks/${card.task.id}/proposals`, body).set(
            'Idempotency-Key',
            'proposal-retry-1',
          )
        ).status,
      ).toBe(201);
    expect(store.all('proposals')).toHaveLength(1);
    expect(
      (await post(team1, `/tasks/${card.task.id}/proposals`, { ...body, idea: 'Вторая идея' })).status,
    ).toBe(201);
    expect(store.all('proposals')).toHaveLength(2);
    expect(
      (
        await post(team1, `/tasks/${card.task.id}/proposals`, { ...body, idea: 'Изменённая идея' }).set(
          'Idempotency-Key',
          'proposal-retry-1',
        )
      ).status,
    ).toBe(409);
  });
  it('creates and joins a team with the same code and revokes sessions on logout', async () => {
    const created = await request(runtime.app).post('/api/v1/teams/start').send({ name: 'Новая команда' });
    expect(created.status).toBe(201);
    const login = await request(runtime.app)
      .post('/api/v1/session/start')
      .send({ code: created.body.data.code });
    expect(login.status).toBe(200);
    expect(login.body.data.actor.teamId).toBe(created.body.data.actor.teamId);
    const token = login.body.data.token;
    expect((await post(token, '/session/end', {})).status).toBe(200);
    expect((await request(runtime.app).get('/api/v1/dashboard').auth(token, { type: 'bearer' })).status).toBe(
      401,
    );
  });
});

it('persists sessions, confirmed data and working copies across a database reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sana-persist-'));
  const path = join(directory, 'db.sqlite');
  try {
    let db = new Store(path);
    const auth = new Auth(db);
    auth.addUser(
      { id: 'owner', role: 'business', displayName: 'Owner', teamId: null },
      'test-persistence-code',
    );
    const token = auth.login('test-persistence-code').token;
    db.saveTask({
      id: 'task',
      businessUserId: 'owner',
      rawDescription: 'source',
      draftFields: { ...emptyFields(), title: 'working' },
      confirmedFields: { ...emptyFields(), title: 'official' },
      publicationStatus: 'published',
      version: 2,
      clarification: null,
      createdAt: '2026-09-23',
      updatedAt: '2026-09-23',
      publishedAt: '2026-09-23',
    });
    db.close();
    db = new Store(path);
    expect(new Auth(db).resolve(token)?.id).toBe('owner');
    expect(db.get('tasks', 'task')).toMatchObject({
      draftFields: { title: 'working' },
      confirmedFields: { title: 'official' },
    });
    db.close();
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('sana-persist-'))
      throw new Error('Unsafe temporary cleanup path');
    rmSync(target, { recursive: true, force: true });
  }
});
