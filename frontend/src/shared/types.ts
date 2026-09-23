// Типы 3D-мира. Бизнес-данные приходят из BFF (backend/client/index.ts); здесь — их компактное
// представление для сцены и типы присутствия игроков (зеркало backend/src/world.ts).
import type { CatalogView } from '../api';

export type Role = 'business' | 'team' | 'guest';
/** Уровни готовности в сцене (BFF: draft / working / ready / priority). */
export type LevelKey = 'draft' | 'work' | 'ready' | 'priority';

type Card = CatalogView['cards'][number];

/** Задача, как её показывает мир: публичные сведения карточки каталога BFF. */
export interface WorldTask {
  id: string;
  title: string;
  industry: string;
  summary: string;
  score: { total: number; levelKey: LevelKey; level: string };
  offersCount: number;
  selectedTeams: { id: string; name: string; color: string }[];
  approvedMilestones: number;
  inReview: boolean;
  publishedAt: string;
}
export const LEVEL_FROM_BFF: Record<string, LevelKey> = { draft: 'draft', working: 'work', ready: 'ready', priority: 'priority' };

export function toWorldTask(c: Card): WorldTask {
  return {
    id: c.id,
    title: c.title,
    industry: c.industry,
    summary: c.summary,
    score: { total: c.readinessScore, levelKey: LEVEL_FROM_BFF[c.readinessLevel] ?? 'draft', level: c.readinessLabel },
    offersCount: c.offersCount,
    selectedTeams: c.selectedTeams.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    approvedMilestones: c.approvedMilestones,
    inReview: c.pendingMilestones > 0,
    publishedAt: c.publishedAt ?? '',
  };
}

/** Команда для базы в мире (GET /api/v1/world). */
export interface WorldTeam { id: string; name: string; color: string; avatarPreset: string; confirmedPoints: number }
export interface Achievement { id: string; teamId: string; teamName: string; teamColor: string; taskId: string; taskTitle: string; milestoneTitle: string; at: string }

// ---- присутствие (синхронизируется через Socket.IO; на баллы не влияет) ----
export type MovementState = 'idle' | 'walk' | 'run';
export type Emote = 'wave' | 'cheer' | 'point' | 'celebrate';
export type PresenceState = 'online' | 'idle' | 'moving' | 'interacting';
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
  demo: boolean;
}
export interface PlayerTick { id: string; p: [number, number, number]; r: number; m: MovementState; s: PresenceState }
export interface TriumphInfo { taskId: string; taskTitle: string; teamId: string; teamName: string; teamColor: string; at: string }
