// Бизнес-правила платформы (ТЗ 7.1) как чистые функции над состоянием.
// Сервер — источник истины: он вызывает эти функции внутри транзакции SQLite.
// Браузерная заглушка (src/api/mock.ts) использует те же функции только для автотестов.
import { calculateScore, compareCatalog, meaningful } from './scoring';
import { applyAnswers, draftFromRaw, evidenceSummary } from './clarify';
import {
  EMPTY_CARD, INDUSTRIES,
  type Achievement, type Card, type ClarifyResult, type Milestone, type MilestoneStatus, type OwnTask, type Proposal, type ProposalStatus,
  type PublicTask, type PublicUser, type Snapshot, type Team,
} from './types';
import { SEED_MILESTONES, SEED_PROPOSALS, SEED_TASKS, SEED_TEAMS, SEED_USERS, type SeedUser } from '../api/seed';

export interface TaskRow {
  id: string; businessUserId: string; companyName: string; rawDescription: string; industry: string;
  confirmed: Card | null; draft: Card; clarify: ClarifyResult | null; answers: Record<string, string>;
  publicationStatus: 'draft' | 'published'; version: number; createdAt: string; updatedAt: string; publishedAt: string | null;
}
export interface ProposalRow { id: string; taskId: string; teamId: string; idea: string; plan: string; estimatedTime: string; prototypeUrl: string; status: ProposalStatus; createdAt: string; decidedAt: string | null }
export interface MilestoneRow { id: string; taskId: string; teamId: string; title: string; acceptanceCriteria: string; points: number; evidenceUrl: string; evidenceNote: string; aiSummary: string; status: MilestoneStatus; approvedBy: string | null; updatedAt: string }
export interface ScoreEvent { id: string; teamId: string; milestoneId: string; points: number; approvedAt: string }
export interface State { revision: number; users: SeedUser[]; teams: Team[]; tasks: TaskRow[]; proposals: ProposalRow[]; milestones: MilestoneRow[]; scoreEvents: ScoreEvent[] }

export class ApiError extends Error {
  constructor(message: string, public status = 400, public field?: string) { super(message); }
}

/** Крупное подтверждённое достижение — повод для события GRAND TRIUMPH в 3D-мире. */
export interface TriumphInfo { taskId: string; taskTitle: string; teamId: string; teamName: string; teamColor: string; at: string }

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function seedState(): State {
  const tasks: TaskRow[] = SEED_TASKS.map((t) => {
    const owner = SEED_USERS.find((u) => u.id === t.owner)!;
    const at = iso(t.hoursAgo * 3600e3);
    const draft = t.published ? t.card : draftFromRaw(t.raw, { ...EMPTY_CARD });
    return {
      id: t.id, businessUserId: t.owner, companyName: owner.companyName!, rawDescription: t.raw, industry: t.industry,
      confirmed: t.published ? clone(t.card) : null, draft: clone(draft), clarify: null, answers: {},
      publicationStatus: t.published ? 'published' : 'draft', version: t.published ? 1 : 0, createdAt: at, updatedAt: at, publishedAt: t.published ? at : null,
    };
  });
  const proposals: ProposalRow[] = SEED_PROPOSALS.map((p, i) => ({ ...p, createdAt: iso((i + 1) * 900e3), decidedAt: p.status === 'pending' ? null : iso(600e3) }));
  const milestones: MilestoneRow[] = SEED_MILESTONES.map((m) => ({ ...m, points: 10, aiSummary: evidenceSummary(m.evidenceUrl, m.acceptanceCriteria), approvedBy: m.status === 'approved' ? 'biz-zhol' : null, updatedAt: iso(300e3) }));
  const scoreEvents: ScoreEvent[] = milestones.filter((m) => m.status === 'approved').map((m) => ({ id: 'se-' + m.id, teamId: m.teamId, milestoneId: m.id, points: m.points, approvedAt: m.updatedAt }));
  const teams = SEED_TEAMS.map((t) => ({ ...t, confirmedPoints: scoreEvents.filter((e) => e.teamId === t.id).reduce((s, e) => s + e.points, 0) }));
  return { revision: 1, users: clone(SEED_USERS), teams, tasks, proposals, milestones, scoreEvents };
}

/** Дополняет сохранённое состояние новыми демо-записями (задачи, участники команд), не трогая данные пользователя. */
export function upgradeState(s: State): boolean {
  let changed = false;
  const seed = seedState();
  const users = new Set(s.users.map((u) => u.id));
  for (const u of seed.users) if (!users.has(u.id)) { s.users.push(u); changed = true; }
  // первый участник команды раньше назывался именем команды
  for (const u of s.users) {
    const fresh = seed.users.find((x) => x.id === u.id);
    if (fresh && u.role === 'team' && u.displayName !== fresh.displayName && s.teams.some((t) => t.name === u.displayName)) { u.displayName = fresh.displayName; changed = true; }
  }
  const tasks = new Set(s.tasks.map((t) => t.id));
  for (const t of seed.tasks) if (t.id.startsWith('task-demo-') && !tasks.has(t.id) && users.has(t.businessUserId)) { s.tasks.push(t); changed = true; }
  if (changed) s.revision++;
  return changed;
}

// ---- доступ ----
export function userOf(s: State, id: string | null | undefined): SeedUser | null {
  return id ? s.users.find((u) => u.id === id) ?? null : null;
}
function requireRole(s: State, actorId: string | null, role: 'business' | 'team'): SeedUser {
  const u = userOf(s, actorId);
  if (!u) throw new ApiError('Войдите в аккаунт', 401);
  if (u.role !== role) throw new ApiError(role === 'team' ? 'Действие доступно только команде' : 'Действие доступно только бизнесу', 403);
  return u;
}
function ownTaskRow(s: State, u: SeedUser, id: string): TaskRow {
  const t = s.tasks.find((x) => x.id === id);
  if (!t) throw new ApiError('Задача не найдена', 404);
  if (t.businessUserId !== u.id) throw new ApiError('Это задача другой компании', 403);
  return t;
}

// ---- валидация ----
const LIMITS: Record<string, number> = { title: 120 };
export function sanitizeCard(c: Partial<Card> | undefined): Card {
  const out = { ...EMPTY_CARD };
  for (const k of Object.keys(EMPTY_CARD) as (keyof Card)[]) {
    const v = c?.[k];
    if (k === 'noKnownConstraints') out.noKnownConstraints = v === true;
    else if (k === 'dataAvailability') out.dataAvailability = v === 'yes' || v === 'no' || v === 'unknown' ? v : '';
    else (out as unknown as Record<string, string>)[k] = String(v ?? '').slice(0, LIMITS[k] ?? 1500);
  }
  return out;
}
function checkUrl(v: unknown, field: string): string {
  try {
    const u = new URL(String(v ?? '').trim());
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')) return u.toString();
  } catch { /* ниже */ }
  throw new ApiError('Укажите корректную ссылку, начиная с http:// или https://', 400, field);
}
function need(v: unknown, min: number, field: string, label: string): string {
  const t = String(v ?? '').trim();
  if (t.length < min) throw new ApiError(`${label}: минимум ${min} символов`, 400, field);
  return t.slice(0, 1500);
}

// ---- представления ----
export const publicUser = (u: SeedUser): PublicUser => ({ id: u.id, role: u.role, displayName: u.displayName, teamId: u.teamId, companyName: u.companyName });

function publicTask(s: State, t: TaskRow): PublicTask {
  const props = s.proposals.filter((p) => p.taskId === t.id);
  const ms = s.milestones.filter((m) => m.taskId === t.id);
  return {
    id: t.id, companyName: t.companyName, industry: t.industry, title: t.confirmed!.title, card: clone(t.confirmed!),
    score: calculateScore(t.confirmed!), offersCount: props.length,
    selectedTeams: props.filter((p) => p.status === 'selected').map((p) => {
      const team = s.teams.find((x) => x.id === p.teamId)!;
      return { id: team.id, name: team.name, color: team.color, approvedMilestones: ms.filter((m) => m.teamId === team.id && m.status === 'approved').length };
    }),
    inReview: ms.some((m) => m.status === 'in_review'),
    approvedMilestones: ms.filter((m) => m.status === 'approved').length,
    publishedAt: t.publishedAt!, version: t.version,
  };
}
function ownTask(t: TaskRow): OwnTask {
  return {
    id: t.id, companyName: t.companyName, industry: t.industry, rawDescription: t.rawDescription, publicationStatus: t.publicationStatus,
    confirmed: t.confirmed ? clone(t.confirmed) : null, draft: clone(t.draft),
    score: t.confirmed ? calculateScore(t.confirmed) : null, forecast: calculateScore(t.draft),
    draftDirty: !t.confirmed || JSON.stringify(t.confirmed) !== JSON.stringify(t.draft),
    clarify: t.clarify ? clone(t.clarify) : null, answers: { ...t.answers }, version: t.version, createdAt: t.createdAt, publishedAt: t.publishedAt,
  };
}
function proposalView(s: State, p: ProposalRow): Proposal {
  const team = s.teams.find((x) => x.id === p.teamId)!;
  return { id: p.id, taskId: p.taskId, teamId: p.teamId, teamName: team.name, teamColor: team.color, idea: p.idea, plan: p.plan, estimatedTime: p.estimatedTime, prototypeUrl: p.prototypeUrl, status: p.status, createdAt: p.createdAt };
}
function milestoneView(s: State, m: MilestoneRow): Milestone {
  const team = s.teams.find((x) => x.id === m.teamId)!;
  return { id: m.id, taskId: m.taskId, teamId: m.teamId, teamName: team.name, title: m.title, acceptanceCriteria: m.acceptanceCriteria, points: m.points, evidenceUrl: m.evidenceUrl, evidenceNote: m.evidenceNote, aiSummary: m.aiSummary, status: m.status, updatedAt: m.updatedAt };
}
/** Публичная лента подтверждённых бизнесом результатов (Hall of Achievements), новые сверху. */
function achievements(s: State): Achievement[] {
  return s.scoreEvents
    .map((e) => {
      const m = s.milestones.find((x) => x.id === e.milestoneId);
      const team = s.teams.find((x) => x.id === e.teamId);
      const task = m ? s.tasks.find((x) => x.id === m.taskId) : undefined;
      if (!m || !team || !task) return null;
      return { id: e.id, teamId: team.id, teamName: team.name, teamColor: team.color, taskId: task.id, taskTitle: task.confirmed?.title ?? task.rawDescription, milestoneTitle: m.title, at: e.approvedAt };
    })
    .filter((x): x is Achievement => !!x)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function snapshot(s: State, actorId: string | null): Snapshot {
  const u = userOf(s, actorId);
  const published = s.tasks.filter((t) => t.publicationStatus === 'published' && t.confirmed).map((t) => publicTask(s, t)).sort(compareCatalog);
  const ownRows = u?.role === 'business' ? s.tasks.filter((t) => t.businessUserId === u.id) : [];
  const ownIds = new Set(ownRows.map((t) => t.id));
  const proposals = u?.role === 'business' ? s.proposals.filter((p) => ownIds.has(p.taskId)) : u?.role === 'team' ? s.proposals.filter((p) => p.teamId === u.teamId) : [];
  const milestones = u?.role === 'business' ? s.milestones.filter((m) => ownIds.has(m.taskId)) : u?.role === 'team' ? s.milestones.filter((m) => m.teamId === u.teamId) : [];
  return {
    revision: s.revision, me: u ? publicUser(u) : null, industries: INDUSTRIES, tasks: published, teams: clone(s.teams),
    ownTasks: ownRows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(ownTask),
    ownProposals: proposals.map((p) => proposalView(s, p)), milestones: milestones.map((m) => milestoneView(s, m)),
    achievements: achievements(s).slice(0, 12), aiMode: 'stub',
  };
}

export interface DemoAccount { id: string; role: 'business' | 'team'; displayName: string; companyName: string | null; team: Team | null }
export function demoAccounts(s: State): DemoAccount[] {
  return s.users.map((u) => ({ id: u.id, role: u.role, displayName: u.displayName, companyName: u.companyName, team: s.teams.find((t) => t.id === u.teamId) ?? null }));
}

// ---- операции (каждая бросает ApiError до изменения состояния или меняет его целиком) ----
export const ops = {
  // FR-01
  createTask(s: State, actorId: string | null, rawDescription: unknown, industry: unknown): string {
    const u = requireRole(s, actorId, 'business');
    const raw = need(rawDescription, 10, 'rawDescription', 'Описание задачи');
    if (typeof industry !== 'string' || !INDUSTRIES.includes(industry)) throw new ApiError('Выберите отрасль', 400, 'industry');
    const id = uid('task');
    const now = iso();
    s.tasks.push({ id, businessUserId: u.id, companyName: u.companyName!, rawDescription: raw, industry, confirmed: null, draft: draftFromRaw(raw, { ...EMPTY_CARD }), clarify: null, answers: {}, publicationStatus: 'draft', version: 0, createdAt: now, updatedAt: now, publishedAt: null });
    return id;
  },

  /** Данные для вызова ИИ (вызов модели идёт вне транзакции). */
  clarifyInput(s: State, actorId: string | null, taskId: string): { raw: string; draft: Card } {
    const u = requireRole(s, actorId, 'business');
    const t = ownTaskRow(s, u, taskId);
    return { raw: t.rawDescription, draft: clone(t.draft) };
  },
  // FR-02
  saveClarify(s: State, actorId: string | null, taskId: string, result: ClarifyResult) {
    const u = requireRole(s, actorId, 'business');
    ownTaskRow(s, u, taskId).clarify = result;
  },

  // FR-03: рабочая копия; официальный балл не меняется
  saveDraft(s: State, actorId: string | null, taskId: string, draft: Card, answers?: Record<string, string>) {
    const u = requireRole(s, actorId, 'business');
    const t = ownTaskRow(s, u, taskId);
    t.draft = sanitizeCard(draft);
    if (answers && typeof answers === 'object') t.answers = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, String(v).slice(0, 1500)]));
    t.updatedAt = iso();
  },

  applyAnswers(s: State, actorId: string | null, taskId: string, answers: Record<string, string>) {
    const u = requireRole(s, actorId, 'business');
    const t = ownTaskRow(s, u, taskId);
    const clean = Object.fromEntries(Object.entries(answers ?? {}).map(([k, v]) => [k, String(v).slice(0, 1500)]));
    t.answers = clean;
    t.draft = sanitizeCard(applyAnswers(t.draft, clean));
  },

  // FR-04/05: атомарная замена подтверждённой версии и пересчёт
  confirm(s: State, actorId: string | null, taskId: string): { before: number | null; after: number } {
    const u = requireRole(s, actorId, 'business');
    const t = ownTaskRow(s, u, taskId);
    if (!meaningful(t.draft.title, 5)) throw new ApiError('Укажите название задачи (от 5 символов)', 400, 'title');
    const before = t.confirmed ? calculateScore(t.confirmed).total : null;
    t.confirmed = clone(t.draft);
    t.version++;
    t.updatedAt = iso();
    return { before, after: calculateScore(t.confirmed).total };
  },

  // FR-06
  publish(s: State, actorId: string | null, taskId: string) {
    const u = requireRole(s, actorId, 'business');
    const t = ownTaskRow(s, u, taskId);
    if (!t.confirmed) throw new ApiError('Сначала подтвердите сведения карточки');
    if (t.publicationStatus === 'published') throw new ApiError('Задача уже опубликована');
    t.publicationStatus = 'published';
    t.publishedAt = iso();
  },

  // FR-08: отклик не меняет рейтинг задачи
  createProposal(s: State, actorId: string | null, taskId: string, p: { idea: string; plan: string; estimatedTime: string; prototypeUrl: string }) {
    const u = requireRole(s, actorId, 'team');
    const t = s.tasks.find((x) => x.id === taskId && x.publicationStatus === 'published');
    if (!t) throw new ApiError('Задача не опубликована', 404);
    s.proposals.push({
      id: uid('prop'), taskId, teamId: u.teamId!, idea: need(p?.idea, 15, 'idea', 'Идея решения'), plan: need(p?.plan, 15, 'plan', 'План'),
      estimatedTime: need(p?.estimatedTime, 2, 'estimatedTime', 'Срок'), prototypeUrl: checkUrl(p?.prototypeUrl, 'prototypeUrl'),
      status: 'pending', createdAt: iso(), decidedAt: null,
    });
  },

  // FR-09: ручное решение только владельцем
  decide(s: State, actorId: string | null, proposalId: string, decision: 'select' | 'reject') {
    const u = requireRole(s, actorId, 'business');
    if (decision !== 'select' && decision !== 'reject') throw new ApiError('Неизвестное решение');
    const p = s.proposals.find((x) => x.id === proposalId);
    if (!p) throw new ApiError('Отклик не найден', 404);
    ownTaskRow(s, u, p.taskId);
    p.status = decision === 'select' ? 'selected' : 'rejected';
    p.decidedAt = iso();
  },

  // P1: один этап на выбранную команду и задачу
  createMilestone(s: State, actorId: string | null, taskId: string, m: { title: string; acceptanceCriteria: string }) {
    const u = requireRole(s, actorId, 'team');
    if (!s.proposals.some((p) => p.taskId === taskId && p.teamId === u.teamId && p.status === 'selected')) throw new ApiError('Этап может создать только выбранная команда', 403);
    if (s.milestones.some((x) => x.taskId === taskId && x.teamId === u.teamId)) throw new ApiError('Этап по этой задаче уже создан');
    s.milestones.push({ id: uid('ms'), taskId, teamId: u.teamId!, title: need(m?.title, 5, 'title', 'Название этапа'), acceptanceCriteria: need(m?.acceptanceCriteria, 10, 'acceptanceCriteria', 'Критерий приёмки'), points: 10, evidenceUrl: '', evidenceNote: '', aiSummary: '', status: 'planned', approvedBy: null, updatedAt: iso() });
  },

  submitEvidence(s: State, actorId: string | null, milestoneId: string, e: { evidenceUrl: string; evidenceNote: string }) {
    const u = requireRole(s, actorId, 'team');
    const m = s.milestones.find((x) => x.id === milestoneId);
    if (!m || m.teamId !== u.teamId) throw new ApiError('Этап не найден', 404);
    if (m.status === 'approved') throw new ApiError('Этап уже подтверждён');
    m.evidenceUrl = checkUrl(e?.evidenceUrl, 'evidenceUrl');
    m.evidenceNote = need(e?.evidenceNote, 10, 'evidenceNote', 'Описание сделанного');
    m.aiSummary = evidenceSummary(m.evidenceUrl, m.acceptanceCriteria);
    m.status = 'in_review'; // очки не начисляются
    m.updatedAt = iso();
  },

  /**
   * Решение бизнеса по этапу. Этап в P1 — единственный результат команды по задаче,
   * поэтому его подтверждение = завершение задачи командой → возвращается TriumphInfo (ровно один раз).
   */
  decideMilestone(s: State, actorId: string | null, milestoneId: string, decision: 'approve' | 'rework'): TriumphInfo | null {
    const u = requireRole(s, actorId, 'business');
    const m = s.milestones.find((x) => x.id === milestoneId);
    if (!m) throw new ApiError('Этап не найден', 404);
    const task = ownTaskRow(s, u, m.taskId);
    if (m.status !== 'in_review') throw new ApiError('Этап не ожидает проверки');
    if (decision === 'rework') { m.status = 'rework'; m.updatedAt = iso(); return null; }
    if (decision !== 'approve') throw new ApiError('Неизвестное решение');
    m.status = 'approved';
    m.approvedBy = u.id;
    m.updatedAt = iso();
    if (s.scoreEvents.some((e) => e.milestoneId === m.id)) return null; // защита от двойного начисления
    s.scoreEvents.push({ id: uid('se'), teamId: m.teamId, milestoneId: m.id, points: m.points, approvedAt: m.updatedAt });
    const team = s.teams.find((t) => t.id === m.teamId)!;
    team.confirmedPoints += m.points;
    return { taskId: task.id, taskTitle: task.confirmed?.title ?? task.rawDescription, teamId: team.id, teamName: team.name, teamColor: team.color, at: m.updatedAt };
  },
};
