// 3D-world types. Business data comes from the BFF (backend/client/index.ts); here is its compact
// representation for the scene and player presence types (mirror of backend/src/world.ts).
import type { CatalogView } from '../api';

export type Role = 'business' | 'team' | 'guest';
/** Readiness levels in the scene (BFF: draft / working / ready / priority). */
export type LevelKey = 'draft' | 'work' | 'ready' | 'priority';

type Card = CatalogView['cards'][number];

/** A task as the world shows it: public details of a BFF catalog card. */
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

/** A team for its in-world base (GET /api/v1/world). */
export interface WorldTeam { id: string; name: string; color: string; avatarPreset: string; confirmedPoints: number }
export interface Achievement { id: string; teamId: string; teamName: string; teamColor: string; taskId: string; taskTitle: string; milestoneTitle: string; at: string }

// ---- presence (synced via Socket.IO; does not affect scores) ----
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
