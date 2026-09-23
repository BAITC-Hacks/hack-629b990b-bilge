// World events. Ambient ones (birds, drone, fountain…) are local and purely visual; they don't affect scores or data.
// GRAND TRIUMPH comes only from the server after business confirmation.
import type { TriumphInfo } from '../../shared/types';

export type AmbientKind = 'birds' | 'npc-group' | 'fountain' | 'vehicle' | 'drone' | 'banners' | 'sparkle';
export const AMBIENT_LABEL: Record<AmbientKind, string> = {
  birds: 'birds over the plaza', 'npc-group': 'a group of passers-by', fountain: 'fountain surges', vehicle: 'service vehicle', drone: 'drone over the innovation district', banners: 'gust of wind', sparkle: 'sparkles at a task building',
};
export interface AmbientEvent { id: number; kind: AmbientKind; start: number; duration: number; target?: string }
export interface TriumphState extends TriumphInfo { start: number; duration: number }

export const TRIUMPH_MS = 9000;

type Listener = () => void;

export class WorldEventManager {
  ambient: AmbientEvent[] = [];
  triumph: TriumphState | null = null;
  private queue: TriumphInfo[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private taskIds: string[] = [];
  reduced = false;

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach((l) => l()); }

  setTasks(ids: string[]) { this.taskIds = ids; }

  /** One calm event every 30–90 s. */
  startAmbient() {
    const schedule = () => {
      this.timer = setTimeout(() => { this.fireRandom(); schedule(); }, 30000 + Math.random() * 60000);
    };
    this.stop();
    this.timer = setTimeout(() => { this.fireRandom(); schedule(); }, 9000); // the first one shortly after entering
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  fireRandom() {
    const kinds: AmbientKind[] = ['birds', 'npc-group', 'fountain', 'vehicle', 'drone', 'banners', 'sparkle'];
    this.fire(kinds[Math.floor(Math.random() * kinds.length)]);
  }
  fire(kind: AmbientKind) {
    if (this.reduced && kind !== 'fountain' && kind !== 'sparkle') return;
    const duration = kind === 'vehicle' ? 16000 : kind === 'npc-group' ? 22000 : kind === 'drone' ? 18000 : 9000;
    const target = kind === 'sparkle' && this.taskIds.length ? this.taskIds[Math.floor(Math.random() * this.taskIds.length)] : undefined;
    const e: AmbientEvent = { id: this.nextId++, kind, start: performance.now(), duration, target };
    this.ambient.push(e);
    this.emit();
    setTimeout(() => { this.ambient = this.ambient.filter((x) => x.id !== e.id); this.emit(); }, duration);
  }
  isActive(kind: AmbientKind) { return this.ambient.some((e) => e.kind === kind); }

  /** Server event. If a triumph is already running, the next one waits in the queue. */
  pushTriumph(t: TriumphInfo) {
    if (this.triumph) { this.queue.push(t); return; }
    this.triumph = { ...t, start: performance.now(), duration: this.reduced ? 6000 : TRIUMPH_MS };
    this.emit();
    setTimeout(() => {
      this.triumph = null;
      this.emit();
      const next = this.queue.shift();
      if (next) setTimeout(() => this.pushTriumph(next), 600);
    }, this.triumph.duration);
  }
  /** Triumph progress 0..1 or -1. */
  triumphProgress(now = performance.now()): number {
    if (!this.triumph) return -1;
    return Math.min(1, (now - this.triumph.start) / this.triumph.duration);
  }
}
