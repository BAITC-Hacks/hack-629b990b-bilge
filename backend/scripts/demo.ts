import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Store } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { createAiProvider } from '../src/integrations/ai.js';
import { createGitProvider } from '../src/integrations/git.js';
import { readConfig } from '../src/config.js';
import { emptyFields } from '../src/contracts.js';

const live = process.argv.includes('--live');
const config = readConfig();
if (live && !config.OPENAI_API_KEY) throw new Error('Live demo requires OPENAI_API_KEY in backend/.env');
const directory = mkdtempSync(join(tmpdir(), 'sana-demo-'));
const store = new Store(join(directory, 'demo.db'));
const accounts = seed(store).accounts;
const runtime = createApp({
  store,
  rateLimit: false,
  ai: createAiProvider({
    mode: live ? 'openai' : 'stub',
    apiKey: config.OPENAI_API_KEY,
    model: config.OPENAI_MODEL,
  }),
  git: createGitProvider({ mode: live ? 'real' : 'mock', token: config.GITHUB_TOKEN }),
});
await new Promise<void>((r) => runtime.httpServer.listen(0, '127.0.0.1', r));
const address = runtime.httpServer.address();
if (!address || typeof address === 'string') throw new Error('No listening address');
const base = `http://127.0.0.1:${address.port}/api/v1`;
async function call(path: string, token?: string, body?: object) {
  const res = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = (await res.json()) as { data: any; error?: { message: string } };
  if (!res.ok) throw new Error(`${path} ${res.status}: ${value.error?.message}`);
  return value.data;
}
try {
  const login = async (id: string) =>
    call('/session/start', undefined, { code: accounts.find((a) => a.id === id)!.code });
  const business = (await login('demo-business-cafe')).token as string;
  const team1 = (await login('demo-student-1')).token as string;
  const team2 = (await login('demo-student-2')).token as string;
  let workspace = await call('/tasks/start', business, {
    rawDescription: 'В кафе остаётся много непроданной еды',
    industry: 'Общепит',
  });
  const id = workspace.task.id;
  workspace = await call(`/tasks/${id}/clarify`, business, { expectedVersion: workspace.task.version });
  if (workspace.clarification.questions.length < 3) throw new Error('Insufficient questions');
  if (live && workspace.clarification.mode !== 'openai')
    throw new Error(`Live OpenAI fell back: ${workspace.clarification.warning}`);
  console.log(
    `Clarification: ${workspace.clarification.mode}, ${workspace.clarification.questions.length} questions`,
  );
  workspace = await call(`/tasks/${id}/draft`, business, {
    expectedVersion: workspace.task.version,
    fields: {
      ...emptyFields(),
      title: 'Прогноз закупок для кафе',
      industry: 'Общепит',
      context: 'Остаётся непроданная еда',
      need: 'Сократить списания',
      users: 'Менеджер кафе',
      dataAvailability: 'available',
      dataSource: 'CSV продаж и списаний за три месяца',
      expectedResult: 'Прототип прогноза закупок',
      acceptanceCriteria: 'Загрузить CSV и показать прогноз по блюдам',
      constraints: 'Две недели',
      contact: 'demo@example.test',
      interactionFormat: 'Два созвона в неделю',
    },
  });
  workspace = await call(`/tasks/${id}/confirm`, business, { expectedVersion: workspace.task.version });
  if (workspace.officialScore.value !== 100) throw new Error('Expected 100 confirmed points');
  workspace = await call(`/tasks/${id}/publish`, business, { expectedVersion: workspace.task.version });
  for (const token of [team1, team2])
    await call(`/tasks/${id}/proposals`, token, {
      idea: 'Прогнозировать спрос по продажам',
      plan: 'Проанализировать данные и показать прототип',
      estimatedTime: 'Две недели',
      prototypeUrl: 'https://github.com/openai/openai-node',
    });
  const desk = await call(`/tasks/${id}/review`, business);
  for (const p of desk.proposals)
    await call(`/proposals/${p.id}/decision`, business, { expectedVersion: p.version, decision: 'select' });
  const phase = await call(`/tasks/${id}/milestones`, team1, {
    title: 'Прогноз на примере',
    acceptanceCriteria: 'Показать CSV и прогноз по блюдам',
  });
  const submitted = await call(`/milestones/${phase.milestone.id}/evidence`, team1, {
    expectedVersion: phase.milestone.version,
    evidenceUrl: 'https://github.com/openai/openai-node',
    description: 'Подготовлена демонстрация загрузки и отображения прогноза',
  });
  if (live && submitted.milestone.evidence.status !== 'verified')
    throw new Error('Live Git metadata was not verified');
  if (live && submitted.milestone.review.mode !== 'openai')
    throw new Error('Live evidence AI review fell back');
  console.log(`Evidence review: ${submitted.milestone.review.mode}`);
  if (submitted.milestone.confirmedPoints !== 0) throw new Error('Points awarded before approval');
  const approval = { expectedVersion: submitted.milestone.version, decision: 'approve' };
  await call(`/milestones/${phase.milestone.id}/decision`, business, approval);
  await call(`/milestones/${phase.milestone.id}/decision`, business, approval);
  const dashboard = await call('/dashboard', team1);
  if (dashboard.team.confirmedPoints !== 10) throw new Error('Award was not exactly once');
  console.log(
    'PASS: fresh cafe task -> publication -> two proposals -> two selected teams -> evidence -> approval -> exactly 10 points',
  );
  console.log(
    `Evidence mode: ${submitted.milestone.evidence.provider}. Source URLs are demo evidence only; business approval was simulated by the smoke script.`,
  );
} finally {
  await runtime.close();
  store.close();
  const target = resolve(directory);
  const parent = resolve(tmpdir());
  if (!target.startsWith(parent + sep) || !target.split(sep).at(-1)?.startsWith('sana-demo-'))
    throw new Error('Unsafe temporary cleanup path');
  rmSync(target, { recursive: true, force: true });
}
