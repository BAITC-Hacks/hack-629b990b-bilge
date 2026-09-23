import type { Server, Socket } from 'socket.io';
import type { Actor, Milestone, Task, Team } from './contracts.js';
import type { Store } from './db.js';

/**
 * Player presence in the 3D world on top of the shared Socket.IO server.
 * Team, role and color come from the session (socket.data.actor). In this BFF a team has one shared
 * code and one user, so a player = a connection, and the participant sets their own name (display
 * only). Movement, emotes and presence never affect scores or business data.
 */
export const WORLD_HALF = 88;
export const NET_HZ = 12;
const RUN_SPEED = 7.2;
const EMOTES = ['wave', 'cheer', 'point', 'celebrate'] as const;
type Emote = (typeof EMOTES)[number];
const EMOTE_MS: Record<Emote, number> = { wave: 2200, cheer: 2200, point: 2000, celebrate: 3200 };
const AVATARS = ['male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f', 'female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f'];
const IDLE_AFTER_MS = 15000;

export type MovementState = 'idle' | 'walk' | 'run';
export type PresenceState = 'online' | 'idle' | 'moving' | 'interacting';
export type PlayerPresence = {
  userId: string;
  displayName: string;
  role: 'business' | 'team' | 'guest';
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
};
export type PlayerTick = { id: string; p: [number, number, number]; r: number; m: MovementState; s: PresenceState };
export type TriumphInfo = { taskId: string; taskTitle: string; teamId: string; teamName: string; teamColor: string; at: string };

type Entry = {
  presence: PlayerPresence;
  lastMoveAt: number;
  lastActionAt: number;
  dirty: boolean;
  window: number;
  count: number;
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function hash32(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** Name tag: printable characters only, no markup, up to 24 characters. */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

export class WorldPresence {
  private players = new Map<string, Entry>();
  private timer: NodeJS.Timeout;

  constructor(
    private io: Server,
    private store: Store,
  ) {
    this.timer = setInterval(() => this.tick(), 1000 / NET_HZ);
    this.timer.unref();
    io.on('connection', (socket) => this.attach(socket));
  }
  close() {
    clearInterval(this.timer);
  }
  list() {
    return [...this.players.values()].map((e) => e.presence);
  }

  private identity(socket: Socket, name: string, demo: boolean) {
    const actor = socket.data.actor as Actor | null;
    const id = `p-${socket.id}`;
    if (!actor)
      return { userId: id, displayName: name || 'Guest', role: 'guest' as const, teamId: null, teamName: null, teamColor: '#9aa3b2', demo };
    const team = actor.teamId ? this.store.get<Team>('teams', actor.teamId) : undefined;
    return {
      userId: id,
      displayName: name || actor.displayName,
      role: actor.role,
      teamId: team?.id ?? null,
      teamName: team?.name ?? null,
      teamColor: team?.color ?? '#16324f',
      demo,
    };
  }

  private attach(socket: Socket) {
    const id = `p-${socket.id}`;
    const own = () => this.players.get(id);
    const allow = (e: Entry) => {
      const now = Date.now();
      if (now - e.window > 1000) {
        e.window = now;
        e.count = 0;
      }
      return ++e.count <= 30;
    };
    socket.on('world.player.join', (msg: { p?: unknown; r?: unknown; name?: unknown; demo?: unknown } | undefined, ack?: unknown) => {
      const name = cleanName(msg?.name);
      const who = this.identity(socket, name, msg?.demo === true && process.env.DEMO_BOTS !== '0');
      const p = Array.isArray(msg?.p) && msg!.p.length === 3 && msg!.p.every(finite) ? (msg!.p as number[]) : [0, 0, 27];
      const presence: PlayerPresence = {
        ...who,
        avatarPreset: AVATARS[hash32(`${who.teamId ?? who.role}:${who.displayName}`) % AVATARS.length]!,
        position: [clamp(p[0]!, -WORLD_HALF, WORLD_HALF), 0, clamp(p[2]!, -WORLD_HALF, WORLD_HALF)],
        rotation: finite(msg?.r) ? msg!.r : 0,
        movementState: 'idle',
        actionState: null,
        presence: 'online',
        online: true,
      };
      const existed = this.players.has(id);
      this.players.set(id, { presence, lastMoveAt: Date.now(), lastActionAt: 0, dirty: false, window: Date.now(), count: 0 });
      void socket.join('world');
      if (typeof ack === 'function') ack({ you: id, players: this.list(), netHz: NET_HZ });
      socket.to('world').emit(existed ? 'world.player.update' : 'world.player.join', presence);
    });
    socket.on('world.player.move', (msg: { p?: unknown; r?: unknown; m?: unknown } | undefined) => {
      const e = own();
      if (!e || !allow(e) || !msg || !Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(finite) || !finite(msg.r)) return;
      const now = Date.now();
      const [x, , z] = msg.p as number[];
      const nx = clamp(x!, -WORLD_HALF, WORLD_HALF);
      const nz = clamp(z!, -WORLD_HALF, WORLD_HALF);
      const [ox, , oz] = e.presence.position;
      const d = Math.hypot(nx - ox, nz - oz);
      const maxD = RUN_SPEED * 1.6 * Math.max(0.05, (now - e.lastMoveAt) / 1000) + 1.5;
      const k = d > maxD ? maxD / d : 1; // soft speed limit
      e.presence.position = [ox + (nx - ox) * k, 0, oz + (nz - oz) * k];
      e.presence.rotation = msg.r;
      const m: MovementState = msg.m === 'walk' || msg.m === 'run' ? msg.m : 'idle';
      e.presence.movementState = m;
      if (m !== 'idle') {
        e.lastMoveAt = now;
        if (e.presence.presence !== 'interacting') e.presence.presence = 'moving';
      }
      e.dirty = true;
    });
    socket.on('world.player.action', (msg: { action?: unknown } | undefined) => {
      const e = own();
      if (!e || !allow(e)) return;
      const action = msg?.action as Emote;
      if (!EMOTES.includes(action)) return;
      const now = Date.now();
      if (now - e.lastActionAt < 800) return;
      e.lastActionAt = now;
      e.presence.actionState = action;
      this.io.to('world').emit('world.player.action', { userId: id, action, until: now + EMOTE_MS[action] });
      setTimeout(() => {
        if (e.presence.actionState === action && Date.now() - e.lastActionAt >= EMOTE_MS[action] - 50) e.presence.actionState = null;
      }, EMOTE_MS[action]).unref();
    });
    socket.on('world.player.interact', (msg: { on?: unknown } | undefined) => {
      const e = own();
      if (!e || !allow(e)) return;
      e.presence.presence = msg?.on === true ? 'interacting' : 'online';
      e.dirty = true;
    });
    const leave = () => {
      if (!this.players.delete(id)) return;
      void socket.leave('world');
      this.io.to('world').emit('world.player.leave', { userId: id });
    };
    socket.on('world.player.leave', leave);
    socket.on('disconnect', leave);
  }

  private tick() {
    const now = Date.now();
    const batch: PlayerTick[] = [];
    for (const e of this.players.values()) {
      const p = e.presence;
      let s = p.presence;
      if (s === 'moving' && p.movementState === 'idle') s = 'online';
      if (s === 'online' && now - e.lastMoveAt > IDLE_AFTER_MS) s = 'idle';
      if (s !== p.presence) {
        p.presence = s;
        e.dirty = true;
      }
      if (!e.dirty) continue;
      e.dirty = false;
      batch.push({ id: p.userId, p: p.position, r: p.rotation, m: p.movementState, s: p.presence });
    }
    if (batch.length) this.io.to('world').emit('world.player.state', batch);
  }

  /** GRAND TRIUMPH: called by the server only after the business first approves a milestone. */
  triumph(milestone: Milestone) {
    const team = this.store.get<Team>('teams', milestone.teamId);
    const task = this.store.get<Task>('tasks', milestone.taskId);
    if (!team || !task) return;
    const info: TriumphInfo = {
      taskId: task.id,
      taskTitle: (task.confirmedFields ?? task.draftFields).title,
      teamId: team.id,
      teamName: team.name,
      teamColor: team.color,
      at: milestone.approvedAt ?? new Date().toISOString(),
    };
    this.io.to('public').emit('world.triumph', info);
  }
}

/** Public world data: teams (for bases) and a feed of approved results (Hall of Achievements). */
export function worldView(store: Store) {
  const teams = store.all<Team>('teams').map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    avatarPreset: t.avatarPreset,
    confirmedPoints: store.points(t.id),
  }));
  const achievements = store
    .all<Milestone>('milestones')
    .filter((m) => m.status === 'approved' && m.approvedAt)
    .map((m) => {
      const team = store.get<Team>('teams', m.teamId);
      const task = store.get<Task>('tasks', m.taskId);
      return {
        id: m.id,
        teamId: m.teamId,
        teamName: team?.name ?? '',
        teamColor: team?.color ?? '#9aa3b2',
        taskId: m.taskId,
        taskTitle: task?.confirmedFields?.title ?? '',
        milestoneTitle: m.title,
        at: m.approvedAt!,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);
  return { screen: 'world' as const, teams, achievements, netHz: NET_HZ, worldHalf: WORLD_HALF };
}
export type WorldView = ReturnType<typeof worldView>;
