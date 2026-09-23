// Client-side state of online players. Positions live in interpolation buffers (outside React);
// the player list and identities live in a subscribable store (React re-renders only on join/leave/data change).
import type { Emote, PlayerPresence, PlayerTick } from '../../shared/types';
import { InterpBuffer } from './NetworkInterpolation';

export interface RemoteState {
  presence: PlayerPresence;
  buffer: InterpBuffer;
  /** Current social animation until `until` (ms, server send time ≈ local time) */
  action: { name: Emote; until: number } | null;
}

type Listener = () => void;

export class PresenceStore {
  me: string | null = null;
  players = new Map<string, RemoteState>();
  version = 0;
  connected = false;
  error: string | null = null;
  netHz = 12;
  /** How many state packets arrived in the last second (for ?debug3d=1). */
  ticksPerSec = 0;
  private tickCount = 0;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval>;

  constructor() {
    this.timer = setInterval(() => { this.ticksPerSec = this.tickCount; this.tickCount = 0; }, 1000);
  }
  dispose() { clearInterval(this.timer); this.listeners.clear(); }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.version++; this.listeners.forEach((l) => l()); }

  reset(me: string, list: PlayerPresence[]) {
    this.me = me;
    this.players.clear();
    for (const p of list) this.upsert(p, false);
    this.emit();
  }
  upsert(p: PlayerPresence, notify = true) {
    const cur = this.players.get(p.userId);
    if (cur) cur.presence = { ...cur.presence, ...p };
    else {
      const buffer = new InterpBuffer();
      buffer.push({ t: performance.now(), x: p.position[0], z: p.position[2], r: p.rotation });
      this.players.set(p.userId, { presence: p, buffer, action: p.actionState ? { name: p.actionState, until: performance.now() + 2000 } : null });
    }
    if (notify) this.emit();
  }
  remove(userId: string) { if (this.players.delete(userId)) this.emit(); }
  applyTicks(batch: PlayerTick[]) {
    const now = performance.now();
    this.tickCount++;
    let statusChanged = false;
    for (const t of batch) {
      const st = this.players.get(t.id);
      if (!st) continue;
      if (t.id !== this.me) st.buffer.push({ t: now, x: t.p[0], z: t.p[2], r: t.r });
      st.presence.position = t.p;
      st.presence.rotation = t.r;
      st.presence.movementState = t.m;
      if (st.presence.presence !== t.s) { st.presence.presence = t.s; statusChanged = true; }
    }
    if (statusChanged) this.emit();
  }
  action(userId: string, name: Emote, until: number) {
    const st = this.players.get(userId);
    if (!st) return;
    // the server sends `until` in its own clock; convert it to a duration
    const dur = Math.max(500, Math.min(5000, until - Date.now()));
    st.action = { name, until: performance.now() + dur };
  }
  setConnection(connected: boolean, error: string | null = null) { this.connected = connected; this.error = error; this.emit(); }

  list(): PlayerPresence[] { return [...this.players.values()].map((s) => s.presence); }
}
