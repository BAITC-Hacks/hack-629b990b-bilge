// Общие типы клиента и сервера. Сервер — источник истины; клиент никогда не присылает баллы.

export type Role = 'business' | 'team' | 'guest';
export type DataAvailability = '' | 'yes' | 'no' | 'unknown';

/** Структурированная карточка бизнес-задачи (ТЗ 4.2: часть полей собирается структурно). */
export interface Card {
  title: string;
  context: string;
  need: string;
  users: string;
  dataAvailability: DataAvailability;
  dataSource: string;
  expectedResult: string;
  successMetric: string;
  successTarget: string;
  acceptanceItem: string;
  constraints: string;
  noKnownConstraints: boolean;
  contactChannel: string;
  interactionFormat: string;
}

export const EMPTY_CARD: Card = {
  title: '',
  context: '',
  need: '',
  users: '',
  dataAvailability: '',
  dataSource: '',
  expectedResult: '',
  successMetric: '',
  successTarget: '',
  acceptanceItem: '',
  constraints: '',
  noKnownConstraints: false,
  contactChannel: '',
  interactionFormat: '',
};

export type LevelKey = 'draft' | 'work' | 'ready' | 'priority';

export interface BreakdownItem {
  key: string;
  label: string;
  points: number;
  earned: number;
  hint: string;
}
export interface BreakdownCategory {
  key: string;
  label: string;
  max: number;
  got: number;
  items: BreakdownItem[];
}
export interface Score {
  total: number;
  levelKey: LevelKey;
  level: string;
  categories: BreakdownCategory[];
  missing: { text: string; points: number }[];
  next: { text: string; points: number } | null;
}

/** Поля, о которых ИИ может задавать вопросы (ТЗ 4.3). */
export const AI_FIELDS = [
  'context',
  'need',
  'users',
  'dataMaterials',
  'constraints',
  'expectedResult',
  'successCriteria',
  'contact',
  'interactionFormat',
] as const;
export type AiField = (typeof AI_FIELDS)[number];

export interface ClarifyQuestion {
  field: AiField;
  text: string;
}
export interface ClarifyResult {
  mode: 'openai' | 'stub';
  missingFields: AiField[];
  questions: ClarifyQuestion[];
  trace: { prompt: string; input: unknown; attempts: { raw: string; error: string | null }[]; fallbackReason: string | null };
}

export type PublicationStatus = 'draft' | 'published';
export type ProposalStatus = 'pending' | 'selected' | 'rejected';
export type MilestoneStatus = 'planned' | 'in_review' | 'rework' | 'approved';

export interface PublicUser {
  id: string;
  role: Role;
  displayName: string;
  teamId: string | null;
  companyName: string | null;
}

export interface Team {
  id: string;
  name: string;
  interests: string[];
  skills: string[];
  technologies: string[];
  avatarPreset: string;
  color: string;
  confirmedPoints: number;
}

/** Публичное представление задачи: видно всем, включая гостя. */
export interface PublicTask {
  id: string;
  companyName: string;
  industry: string;
  title: string;
  card: Card;
  score: Score;
  offersCount: number;
  selectedTeams: { id: string; name: string; color: string; approvedMilestones: number }[];
  inReview: boolean;
  approvedMilestones: number;
  publishedAt: string;
  version: number;
}

/** Задача владельца: рабочая копия, подтверждённая версия и прогноз. */
export interface OwnTask {
  id: string;
  companyName: string;
  industry: string;
  rawDescription: string;
  publicationStatus: PublicationStatus;
  confirmed: Card | null;
  draft: Card;
  score: Score | null;
  forecast: Score;
  draftDirty: boolean;
  clarify: ClarifyResult | null;
  answers: Record<string, string>;
  version: number;
  createdAt: string;
  publishedAt: string | null;
}

export interface Proposal {
  id: string;
  taskId: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  idea: string;
  plan: string;
  estimatedTime: string;
  prototypeUrl: string;
  status: ProposalStatus;
  createdAt: string;
}

export interface Milestone {
  id: string;
  taskId: string;
  teamId: string;
  teamName: string;
  title: string;
  acceptanceCriteria: string;
  points: number;
  evidenceUrl: string;
  evidenceNote: string;
  aiSummary: string;
  status: MilestoneStatus;
  updatedAt: string;
}

/** Подтверждённый бизнесом результат команды (лента Hall of Achievements). */
export interface Achievement {
  id: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  taskId: string;
  taskTitle: string;
  milestoneTitle: string;
  at: string;
}

export interface Snapshot {
  revision: number;
  me: PublicUser | null;
  industries: string[];
  tasks: PublicTask[];
  teams: Team[];
  ownTasks: OwnTask[];
  ownProposals: Proposal[];
  milestones: Milestone[];
  achievements: Achievement[];
  aiMode: 'openai' | 'stub';
}

// ---- мультиплеер 3D-мира (только присутствие и социальные действия; на баллы не влияет) ----
export type MovementState = 'idle' | 'walk' | 'run';
export type Emote = 'wave' | 'cheer' | 'point' | 'celebrate';
export type PresenceState = 'online' | 'idle' | 'moving' | 'interacting';

/** Игрок в мире. Имя, команда и цвет задаёт сервер по сессии, клиент присылает только движение. */
export interface PlayerPresence {
  userId: string;
  displayName: string;
  role: Role;
  teamId: string | null;
  teamName: string | null;
  teamColor: string;
  avatarPreset: string;
  position: [number, number, number];
  rotation: number;
  movementState: MovementState;
  actionState: Emote | null;
  presence: PresenceState;
  online: boolean;
  /** Подключён скриптом демо-ботов (scripts/demo-bots.ts) — помечается в списке игроков. */
  demo: boolean;
}

/** Сжатое обновление движения (10–15 Гц). */
export interface PlayerTick { id: string; p: [number, number, number]; r: number; m: MovementState; s: PresenceState }

export const INDUSTRIES = ['HoReCa', 'Логистика', 'Ритейл', 'Образование', 'Здравоохранение', 'Финтех', 'Другое'];
