// Браузерная заглушка API поверх общих правил (src/shared/domain.ts).
// Приложение работает через сервер (src/api/http.ts); заглушка нужна автотестам и как справочная реализация контракта.
// Состояние — localStorage, сессия — sessionStorage (своя у каждой «вкладки»).
import { PROMPT, stubQuestions } from '../shared/clarify';
import { ApiError, demoAccounts, ops, seedState, snapshot, publicUser, upgradeState, userOf, type DemoAccount, type State } from '../shared/domain';
import type { Card, ClarifyResult, PublicUser, Snapshot } from '../shared/types';
import { DEMO_EXAMPLE } from './seed';

export { ApiError, type DemoAccount };

const KEY = 'sana-platform-state-v1';
const SESSION = 'sana-platform-session';

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (s && Array.isArray(s.tasks) && Array.isArray(s.teams)) {
        if (upgradeState(s)) save(s);
        return s;
      }
    }
  } catch { /* повреждённое хранилище — начинаем с демо-данных */ }
  const s = seedState();
  save(s);
  return s;
}
function save(s: State) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* приватный режим — в памяти */ }
}
const listeners = new Set<() => void>();
function write<T>(mutate: (s: State, actor: string | null) => T): T {
  const s = load();
  const r = mutate(s, actor()); // бросает ApiError до записи
  s.revision++;
  save(s);
  listeners.forEach((l) => l());
  return r;
}
function actor(): string | null {
  try { const raw = sessionStorage.getItem(SESSION); return raw ? (JSON.parse(raw).userId ?? null) : null; } catch { return null; }
}

export const api = {
  mode: 'mock' as const,
  onChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  hasSession(): boolean { try { return sessionStorage.getItem(SESSION) !== null; } catch { return false; } },
  token(): string | null { return null; },
  async demoAccounts(): Promise<DemoAccount[]> { return demoAccounts(load()); },
  async login(userId: string | null): Promise<PublicUser | null> {
    const s = load();
    if (userId && !userOf(s, userId)) throw new ApiError('Аккаунт не найден', 404);
    sessionStorage.setItem(SESSION, JSON.stringify({ userId, guest: !userId }));
    listeners.forEach((l) => l());
    const u = userOf(s, userId);
    return u ? publicUser(u) : null;
  },
  async logout() { sessionStorage.removeItem(SESSION); listeners.forEach((l) => l()); },
  async snapshot(): Promise<Snapshot> { return snapshot(load(), actor()); },
  async createTask(raw: string, industry: string) { return write((s, a) => ops.createTask(s, a, raw, industry)); },
  async clarify(taskId: string): Promise<ClarifyResult> {
    const input = ops.clarifyInput(load(), actor(), taskId);
    const result: ClarifyResult = { mode: 'stub', ...stubQuestions(input.raw, input.draft), trace: { prompt: PROMPT, input: { rawDescription: input.raw, knownFields: input.draft }, attempts: [], fallbackReason: 'Заглушка без сервера: используется локальный набор вопросов' } };
    write((s, a) => ops.saveClarify(s, a, taskId, result));
    return result;
  },
  async saveDraft(taskId: string, draft: Card, answers?: Record<string, string>) { write((s, a) => ops.saveDraft(s, a, taskId, draft, answers)); },
  async applyAnswers(taskId: string, answers: Record<string, string>) { write((s, a) => ops.applyAnswers(s, a, taskId, answers)); },
  async confirm(taskId: string) { return write((s, a) => ops.confirm(s, a, taskId)); },
  async publish(taskId: string) { write((s, a) => ops.publish(s, a, taskId)); },
  async createProposal(taskId: string, p: { idea: string; plan: string; estimatedTime: string; prototypeUrl: string }) { write((s, a) => ops.createProposal(s, a, taskId, p)); },
  async decide(proposalId: string, decision: 'select' | 'reject') { write((s, a) => ops.decide(s, a, proposalId, decision)); },
  async createMilestone(taskId: string, m: { title: string; acceptanceCriteria: string }) { write((s, a) => ops.createMilestone(s, a, taskId, m)); },
  async submitEvidence(milestoneId: string, e: { evidenceUrl: string; evidenceNote: string }) { write((s, a) => ops.submitEvidence(s, a, milestoneId, e)); },
  async decideMilestone(milestoneId: string, decision: 'approve' | 'rework') { write((s, a) => { ops.decideMilestone(s, a, milestoneId, decision); }); },
  async resetDemo() { save(seedState()); listeners.forEach((l) => l()); },
  demoExample: DEMO_EXAMPLE,
};
