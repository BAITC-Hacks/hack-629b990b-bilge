// Task label budget: to keep the screen from turning into "mush", labels are assigned by proximity to the player.
// full — the single nearest (plus selected/hovered), mini — a few nearest, chip — a level badge, the rest — beacon only.
import type * as THREE from 'three';

export type LabelLod = 'full' | 'mini' | 'chip' | 'hidden';

export const LABEL_LIMITS = { fullDist: 16, mini: 3, miniDist: 45, chip: 6, chipDist: 90 };

export class LabelBudget {
  private lods = new Map<string, LabelLod>();
  private listeners = new Map<string, (l: LabelLod) => void>();
  private positions = new Map<string, { x: number; z: number }>();

  register(id: string, x: number, z: number, onChange: (l: LabelLod) => void) {
    this.positions.set(id, { x, z });
    this.listeners.set(id, onChange);
    return () => { this.positions.delete(id); this.listeners.delete(id); this.lods.delete(id); };
  }

  /** Recalculation (several times per second): ranking by distance to the player. */
  update(player: THREE.Vector3, forced: Set<string>) {
    const list = [...this.positions.entries()].map(([id, p]) => ({ id, d: Math.hypot(p.x - player.x, p.z - player.z) })).sort((a, b) => a.d - b.d);
    let mini = 0, chip = 0;
    list.forEach(({ id, d }, i) => {
      let lod: LabelLod = 'hidden';
      if (forced.has(id) || (i === 0 && d < LABEL_LIMITS.fullDist)) lod = 'full';
      else if (d < LABEL_LIMITS.miniDist && mini < LABEL_LIMITS.mini) { lod = 'mini'; mini++; }
      else if (d < LABEL_LIMITS.chipDist && chip < LABEL_LIMITS.chip) { lod = 'chip'; chip++; }
      if (this.lods.get(id) !== lod) { this.lods.set(id, lod); this.listeners.get(id)?.(lod); }
    });
  }
}
