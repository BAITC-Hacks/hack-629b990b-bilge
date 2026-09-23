import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Store } from '../src/db.js';
import { Auth } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { createAiProvider } from '../src/integrations/ai.js';
import { createGitProvider } from '../src/integrations/git.js';

describe('business and team consumer journeys', () => {
  let store: Store;
  let runtime: ReturnType<typeof createApp>;
  let business: string;
  let team: string;
  let otherTeam: string;
  beforeEach(() => {
    store = new Store();
    const auth = new Auth(store);
    auth.addUser({ id: 'business', role: 'business', displayName: 'Бизнес', teamId: null }, 'business-code');
    for (const id of ['team', 'other-team']) {
      store.saveTeam({
        id,
        name: id,
        interests: [],
        skills: [],
        technologies: [],
        avatarPreset: 'robot',
        color: '#123456',
        confirmedPoints: 0,
      });
      auth.addUser({ id, role: 'team', displayName: id, teamId: id }, `${id}-code`);
    }
    business = auth.login('business-code').token;
    team = auth.login('team-code').token;
    otherTeam = auth.login('other-team-code').token;
    runtime = createApp({
      store,
      ai: createAiProvider({ mode: 'stub' }),
      git: createGitProvider({ mode: 'mock' }),
      rateLimit: false,
    });
  });
  afterEach(async () => {
    await runtime.close();
    store.close();
  });
  const post = (token: string, path: string, input: object) =>
    request(runtime.app).post(`/api/v1${path}`).auth(token, { type: 'bearer' }).send(input);
  const get = (token: string, path: string) =>
    request(runtime.app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  async function publish() {
    const start = await post(business, '/tasks/start', {
      rawDescription: 'Нужен учёт заявок',
      title: 'Учёт заявок',
      industry: 'Сервис',
    });
    const id = start.body.data.task.id;
    const confirmed = await post(business, `/tasks/${id}/confirm`, { expectedVersion: 1 });
    await post(business, `/tasks/${id}/publish`, { expectedVersion: confirmed.body.data.task.version });
    return id as string;
  }
  async function selected() {
    const id = await publish();
    const proposed = await post(team, `/tasks/${id}/proposals`, {
      idea: 'Приложение',
      plan: 'Собрать прототип',
      estimatedTime: 'Неделя',
      prototypeUrl: 'https://example.com',
    });
    const proposal = proposed.body.data.myProposals[0];
    await post(business, `/proposals/${proposal.id}/decision`, {
      expectedVersion: proposal.version,
      decision: 'select',
    });
    const created = await post(team, `/tasks/${id}/milestones`, {
      title: 'Прототип',
      acceptanceCriteria: 'Показать загрузку CSV',
    });
    return { taskId: id, proposalId: proposal.id, milestone: created.body.data.milestone };
  }
  async function submitted() {
    const item = await selected();
    const res = await post(team, `/milestones/${item.milestone.id}/evidence`, {
      expectedVersion: item.milestone.version,
      evidenceUrl: 'https://github.com/example/demo',
      description: 'CSV загружается',
    });
    return { ...item, milestone: res.body.data.milestone };
  }
  it('accepts a real short industry name and gives consistent confirmation affordance', async () => {
    const start = await post(business, '/tasks/start', {
      rawDescription: 'Нужна система заявок',
      title: 'CRM',
      industry: 'IT',
    });
    expect(start.body.data.actions.find((a: { id: string }) => a.id === 'confirm').enabled).toBe(true);
    const confirm = await post(business, `/tasks/${start.body.data.task.id}/confirm`, { expectedVersion: 1 });
    expect(confirm.status).toBe(200);
    const published = await post(business, `/tasks/${start.body.data.task.id}/publish`, {
      expectedVersion: confirm.body.data.task.version,
    });
    expect(published.status).toBe(200);
  });
  it('leads the group from its pending proposal to a selected task and its existing stage', async () => {
    const id = await publish();
    const proposed = await post(team, `/tasks/${id}/proposals`, {
      idea: 'Приложение',
      plan: 'Прототип',
      estimatedTime: 'Неделя',
      prototypeUrl: 'https://example.com',
    });
    expect(proposed.body.data.myProposals[0].statusLabel).toBe('Ожидает решения');
    expect(proposed.body.data.participation).toMatchObject({
      status: 'pending',
      nextAction: { id: 'open_dashboard', taskId: id },
    });
    const p = proposed.body.data.myProposals[0];
    await post(business, `/proposals/${p.id}/decision`, { expectedVersion: p.version, decision: 'select' });
    const selectedCard = await get(team, `/tasks/${id}`);
    expect(selectedCard.body.data.participation.nextAction).toMatchObject({
      id: 'create_milestone',
      taskId: id,
      milestoneId: null,
    });
    const stage = await post(team, `/tasks/${id}/milestones`, {
      title: 'Демо',
      acceptanceCriteria: 'Загрузить CSV',
    });
    const current = await get(team, `/tasks/${id}`);
    expect(current.body.data.participation.nextAction).toMatchObject({
      id: 'open_milestone',
      milestoneId: stage.body.data.milestone.id,
    });
    const dashboard = await get(team, '/dashboard');
    expect(dashboard.body.data.selectedTasks[0].nextAction.milestoneId).toBe(stage.body.data.milestone.id);
    expect((await get(otherTeam, `/tasks/${id}`)).body.data.participation.status).toBe('not_applied');
    expect((await request(runtime.app).get(`/api/v1/tasks/${id}`)).body.data.participation).toBeNull();
  });
  it('removes cancelled work from actionable business reviews and marks it paused for both roles', async () => {
    const { taskId, proposalId, milestone } = await submitted();
    const before = await get(business, '/dashboard');
    expect(before.body.data.tasks[0].nextAction.id).toBe('review');
    await post(business, `/proposals/${proposalId}/decision`, {
      expectedVersion: 2,
      decision: 'reject',
      note: 'Приостановим работу',
    });
    const dashboard = await get(business, '/dashboard');
    expect(dashboard.body.data.tasks[0].pendingReviews).toBe(0);
    expect(dashboard.body.data.tasks[0].pausedMilestones).toBe(1);
    expect((await get(team, `/tasks/${taskId}`)).body.data.participation.status).toBe('paused');
    for (const token of [business, team]) {
      const view = await get(token, `/milestones/${milestone.id}`);
      expect(view.body.data.milestone.statusLabel).toBe('Работа приостановлена');
      expect(view.body.data.milestone.actions.every((a: { enabled: boolean }) => !a.enabled)).toBe(true);
    }
    await post(business, `/proposals/${proposalId}/decision`, { expectedVersion: 3, decision: 'select' });
    expect((await get(business, '/dashboard')).body.data.tasks[0].pendingReviews).toBe(1);
  });
  it('targets a missing return explanation at the feedback form field', async () => {
    const { milestone } = await submitted();
    const res = await post(business, `/milestones/${milestone.id}/decision`, {
      expectedVersion: milestone.version,
      decision: 'return',
      feedback: '',
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'FEEDBACK_REQUIRED',
      fieldErrors: { feedback: [expect.any(String)] },
      recovery: 'correct_fields',
    });
  });
  it('keeps return instructions after resubmission and limits them to the involved roles', async () => {
    const { taskId, milestone } = await submitted();
    const feedback = 'Добавьте пример CSV с тремя заявками';
    const returned = await post(business, `/milestones/${milestone.id}/decision`, {
      expectedVersion: milestone.version,
      decision: 'return',
      feedback,
    });
    const resubmitted = await post(team, `/milestones/${milestone.id}/evidence`, {
      expectedVersion: returned.body.data.milestone.version,
      evidenceUrl: 'https://github.com/example/demo',
      description: 'Добавили три заявки',
    });
    expect(resubmitted.status).toBe(200);
    for (const token of [business, team]) {
      const reloaded = await get(token, `/milestones/${milestone.id}`);
      expect(reloaded.body.data.milestone.previousFeedback).toBe(feedback);
      expect(reloaded.body.data.milestone.reviewHistory).toContainEqual(
        expect.objectContaining({ decision: 'return', feedback }),
      );
    }
    expect((await get(otherTeam, `/milestones/${milestone.id}`)).status).toBe(403);
    expect(JSON.stringify((await request(runtime.app).get(`/api/v1/tasks/${taskId}`)).body)).not.toContain(
      feedback,
    );
  });
  it('tells the business to wait for a draft and clarifies manual review after AI fallback', async () => {
    const { milestone } = await selected();
    const ownerDraft = await get(business, `/milestones/${milestone.id}`);
    expect(ownerDraft.body.data.milestone.statusHint).toMatch(/Команда готовит/);
    const sent = await post(team, `/milestones/${milestone.id}/evidence`, {
      expectedVersion: milestone.version,
      evidenceUrl: 'https://github.com/example/demo',
      description: 'Готово',
    });
    expect(sent.body.data.milestone.reviewNotice).toMatchObject({
      kind: 'manual',
      message: expect.stringContaining('сохран'),
    });
    expect(
      (await get(business, `/milestones/${milestone.id}`)).body.data.milestone.reviewNotice.message,
    ).toMatch(/вручную/);
  });
  it('does not announce another point award when the user retries confirmation', async () => {
    const { milestone } = await submitted();
    const decision = { expectedVersion: milestone.version, decision: 'approve' };
    const first = await post(business, `/milestones/${milestone.id}/decision`, decision);
    expect(first.body.feedback.message).toMatch(/начислено 10/);
    const repeated = await post(business, `/milestones/${milestone.id}/decision`, decision);
    expect(repeated.body.feedback.message).toMatch(/Повторного начисления нет/);
    expect(store.points('team')).toBe(10);
    expect(
      repeated.body.data.milestone.reviewHistory.filter(
        (item: { decision: string }) => item.decision === 'approve',
      ),
    ).toHaveLength(1);
  });
});
