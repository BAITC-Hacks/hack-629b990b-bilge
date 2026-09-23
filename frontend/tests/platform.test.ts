import { test } from 'node:test';
import assert from 'node:assert/strict';

// Хранилища браузера для API-заглушки (каждый «браузер» = своя sessionStorage, общая localStorage).
class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; } setItem(k: string, v: string) { this.m.set(k, String(v)); } removeItem(k: string) { this.m.delete(k); } }
(globalThis as any).localStorage = new Mem();
(globalThis as any).sessionStorage = new Mem();

const { calculateScore, levelOf, compareCatalog, meaningful } = await import('../src/shared/scoring.ts');
const { stubQuestions, validateClarify, applyAnswers, draftFromRaw } = await import('../src/shared/clarify.ts');
const { EMPTY_CARD } = await import('../src/shared/types.ts');
const { api } = await import('../src/api/mock.ts');
const { DEMO_EXAMPLE } = await import('../src/api/seed.ts');

const full = {
  ...EMPTY_CARD,
  title: 'Меньше списаний еды в кафе',
  context: 'Кафе работает с 8 до 22, вечером выбрасываем до трети выпечки.',
  need: 'Понять, сколько и чего готовить.',
  users: 'Шеф-повар и управляющий',
  dataAvailability: 'yes' as const, dataSource: 'Журнал списаний в Excel за 6 месяцев',
  expectedResult: 'Дашборд списаний и рекомендация объёмов приготовления',
  successMetric: 'Списания', successTarget: '−20% за месяц',
  constraints: 'Срок 6 недель, данные внутри кафе',
  contactChannel: 'aigerim@damdi-cafe.kz', interactionFormat: 'Созвон раз в неделю',
};

test('формула: пусто = 0, полная карточка = 100, сумма частей = итог', () => {
  assert.equal(calculateScore(EMPTY_CARD).total, 0);
  const s = calculateScore(full);
  assert.equal(s.total, 100);
  assert.equal(s.categories.reduce((a, c) => a + c.got, 0), s.total);
});

test('формула: «данных нет» = 10, заглушки дают 0, «ограничений нет» = 10', () => {
  assert.equal(calculateScore({ ...EMPTY_CARD, dataAvailability: 'no', dataSource: 'что-то' }).total, 10);
  assert.equal(calculateScore({ ...EMPTY_CARD, dataAvailability: 'unknown' }).total, 0);
  assert.equal(calculateScore({ ...EMPTY_CARD, users: 'не знаю', expectedResult: 'потом уточню' }).total, 0);
  assert.equal(calculateScore({ ...EMPTY_CARD, noKnownConstraints: true }).total, 10);
  assert.equal(meaningful('TBD'), false);
});

test('формула: критерий успеха — показатель с числом или условие приёмки', () => {
  assert.equal(calculateScore({ ...EMPTY_CARD, successMetric: 'Списания', successTarget: 'меньше' }).total, 0);
  assert.equal(calculateScore({ ...EMPTY_CARD, successMetric: 'Списания', successTarget: '−20%' }).total, 15);
  assert.equal(calculateScore({ ...EMPTY_CARD, acceptanceItem: 'Бизнес принимает дашборд на демо' }).total, 15);
});

test('границы уровней 0/39/40/69/70/89/90/100', () => {
  const k = (n: number) => levelOf(n).key;
  assert.deepEqual([0, 39, 40, 69, 70, 89, 90, 100].map(k), ['draft', 'draft', 'work', 'work', 'ready', 'ready', 'priority', 'priority']);
});

test('каталог: балл ↓, при равенстве более новая публикация выше, затем id', () => {
  const t = (id: string, total: number, at: string) => ({ id, score: { total }, publishedAt: at });
  const list = [t('b', 50, '2026-01-01'), t('a', 50, '2026-01-02'), t('c', 90, '2025-01-01'), t('d', 50, '2026-01-02')].sort(compareCatalog);
  assert.deepEqual(list.map((x) => x.id), ['c', 'a', 'd', 'b']);
});

test('ИИ-заглушка: 3–5 вопросов по реально отсутствующим категориям; валидация отклоняет плохой ответ', () => {
  const q = stubQuestions(DEMO_EXAMPLE.raw, draftFromRaw(DEMO_EXAMPLE.raw, { ...EMPTY_CARD }));
  assert.ok(q.questions.length >= 3 && q.questions.length <= 5);
  assert.equal(q.questions[0].field, 'dataMaterials');
  assert.doesNotThrow(() => validateClarify({ missingFields: ['users'], questions: q.questions }));
  assert.throws(() => validateClarify({ missingFields: [], questions: q.questions.slice(0, 2) }));
  assert.throws(() => validateClarify({ missingFields: ['budget'], questions: q.questions }));
  assert.throws(() => validateClarify('не JSON'));
});

test('ответы переносятся в карточку дословно', () => {
  const c = applyAnswers({ ...EMPTY_CARD }, { dataMaterials: 'Журнал списаний', successCriteria: 'Списания −20% за месяц' });
  assert.equal(c.dataSource, 'Журнал списаний');
  assert.equal(c.acceptanceItem, 'Списания −20% за месяц');
});

test('сквозной сценарий: черновик → подтверждение → публикация → отклик → ручной выбор → этап (+10 один раз)', async () => {
  api.resetDemo();
  await api.login('biz-damdi');
  const id = await api.createTask(DEMO_EXAMPLE.raw, 'HoReCa');
  let snap = await api.snapshot();
  assert.equal(snap.tasks.some((t) => t.id === id), false, 'черновик не виден в каталоге');

  const cl = await api.clarify(id);
  assert.ok(cl.questions.length >= 3);
  assert.equal(cl.mode, 'stub');

  await api.applyAnswers(id, DEMO_EXAMPLE.answers);
  snap = await api.snapshot();
  let own = snap.ownTasks.find((t) => t.id === id)!;
  assert.equal(own.score, null, 'до подтверждения официального балла нет');
  assert.ok(own.forecast.total > 0, 'прогноз считается');

  await api.saveDraft(id, { ...own.draft, dataAvailability: 'yes', noKnownConstraints: false });
  const r = await api.confirm(id);
  assert.equal(r.before, null);
  await api.publish(id);
  snap = await api.snapshot();
  const pub = snap.tasks.find((t) => t.id === id)!;
  assert.ok(pub, 'опубликованная задача в каталоге');
  const official = pub.score.total;

  // правка рабочей копии не меняет официальный балл до подтверждения
  own = snap.ownTasks.find((t) => t.id === id)!;
  await api.saveDraft(id, { ...own.draft, acceptanceItem: '', successMetric: '', successTarget: '' });
  snap = await api.snapshot();
  assert.equal(snap.tasks.find((t) => t.id === id)!.score.total, official);
  const down = await api.confirm(id);
  assert.ok(down.after < official, 'после подтверждения удаления балл снижается');

  // команда в другой «вкладке»
  await api.login('user-team-datanomads');
  await assert.rejects(api.decide('prop-2', 'select'), /только бизнесу/);
  await assert.rejects(api.createProposal(id, { idea: 'коротко', plan: 'x', estimatedTime: '1', prototypeUrl: 'x' }));
  await api.createProposal(id, { idea: 'Дашборд списаний на Streamlit', plan: 'Разбор данных, прототип, проверка', estimatedTime: '6 недель', prototypeUrl: 'https://github.com/example/p' });
  snap = await api.snapshot();
  assert.equal(snap.tasks.find((t) => t.id === id)!.offersCount, 1);
  assert.equal(snap.tasks.find((t) => t.id === id)!.selectedTeams.length, 0, 'до ручного выбора выбранных нет');

  // чужой бизнес не может решать
  await api.login('biz-zhol');
  const propId = (await (async () => { await api.login('biz-damdi'); return (await api.snapshot()).ownProposals.find((p) => p.taskId === id)!.id; })());
  await api.login('biz-zhol');
  await assert.rejects(api.decide(propId, 'select'), /другой компании/);

  await api.login('biz-damdi');
  await api.decide(propId, 'select');

  await api.login('user-team-datanomads');
  await api.createMilestone(id, { title: 'Дашборд списаний', acceptanceCriteria: 'Показывает списания по дням недели' });
  let ms = (await api.snapshot()).milestones.find((m) => m.taskId === id)!;
  await api.submitEvidence(ms.id, { evidenceUrl: 'https://github.com/example/p/pull/1', evidenceNote: 'Дашборд и загрузка Excel' });
  snap = await api.snapshot();
  assert.equal(snap.teams.find((t) => t.id === 'team-datanomads')!.confirmedPoints, 0, 'ссылка не начисляет очков');

  await api.login('biz-damdi');
  await api.decideMilestone(ms.id, 'approve');
  await assert.rejects(api.decideMilestone(ms.id, 'approve'), /не ожидает проверки/);
  snap = await api.snapshot();
  assert.equal(snap.teams.find((t) => t.id === 'team-datanomads')!.confirmedPoints, 10, 'ровно +10 один раз');
  assert.equal(snap.tasks.find((t) => t.id === id)!.approvedMilestones, 1);
});
