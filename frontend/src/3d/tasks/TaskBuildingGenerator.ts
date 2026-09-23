// Task building: one generator, decorative presets by industry and visual layers by readiness.
// The building size doesn't change — the styling improves (spec: "don't change the physical size abruptly").
// One taskId → always the same variant (seed = hash(task.id)).
import type { LevelKey } from '../../shared/types';
import { rng } from '../../shared/world';
import type { Part } from '../performance/mergeParts';
import type { BuildingPreset } from '../world/WorldLayout';

export const LEVEL_INDEX: Record<LevelKey, number> = { draft: 0, work: 1, ready: 2, priority: 3 };
export const LEVEL_COLOR: Record<LevelKey, string> = { draft: '#8c95a3', work: '#2d8fbf', ready: '#2f9e44', priority: '#7b3fe4' };
/** Beacon height by level: color isn't the only thing that distinguishes levels. */
export const BEACON_HEIGHT: Record<LevelKey, number> = { draft: 7, work: 13, ready: 22, priority: 30 };

interface Palette { wall: string; accent: string; roof: string; trim: string; glass: string }
const PALETTE: Record<BuildingPreset, Palette> = {
  cafe: { wall: '#fbe3c4', accent: '#f4845f', roof: '#d9674c', trim: '#ffffff', glass: '#ffe9b8' },
  shop: { wall: '#f7d6e0', accent: '#e05a8a', roof: '#8e5572', trim: '#ffffff', glass: '#d7f0ff' },
  warehouse: { wall: '#d3dce6', accent: '#3a86ff', roof: '#71808f', trim: '#f1f4f7', glass: '#cfe8ff' },
  lab: { wall: '#eceef8', accent: '#7b61ff', roof: '#4b4e6d', trim: '#ffffff', glass: '#b9f3ff' },
  academy: { wall: '#f3e6d6', accent: '#2a9d8f', roof: '#b5654a', trim: '#ffffff', glass: '#fff3c4' },
  clinic: { wall: '#f7fbfb', accent: '#14b8a6', roof: '#9fb8c0', trim: '#ffffff', glass: '#d6fbf6' },
  pavilion: { wall: '#eef2f6', accent: '#f9a03f', roof: '#5c6b7a', trim: '#ffffff', glass: '#d7f0ff' },
};
export const PRESET_LABEL: Record<BuildingPreset, string> = {
  cafe: 'Cafe', shop: 'Shop', warehouse: 'Logistics hub', lab: 'Lab', academy: 'Academy', clinic: 'Clinic', pavilion: 'Pavilion',
};

export interface LocalProp { asset: string; x: number; z: number; r: number; s?: number }
export interface BuildingSpec {
  solid: Part[];
  glow: Part[];
  props: LocalProp[];
  /** roof height (for the marker and beacon) */
  height: number;
  /** selected team flag spot (local) */
  flagAt: [number, number];
}

const W = 9, D = 8, FZ = D / 2; // facade on +z

export function generateBuilding(preset: BuildingPreset, level: LevelKey, seed: number): BuildingSpec {
  const L = LEVEL_INDEX[level];
  const pal = PALETTE[preset];
  const r = rng(seed ^ 0x5eed);
  const solid: Part[] = [];
  const glow: Part[] = [];
  const props: LocalProp[] = [];
  const box = (p: [number, number, number], s: [number, number, number], color: string, extra: Partial<Part> = {}) => solid.push({ kind: 'box', p, s, color, ...extra });
  const gbox = (p: [number, number, number], s: [number, number, number], color: string) => glow.push({ kind: 'box', p, s, color });

  // plot pad
  box([0, 0.07, 0.4], [W + 1.4, 0.14, D + 1.6], '#dfe3e8');
  let height = 5;

  switch (preset) {
    case 'cafe': {
      height = 4.4;
      box([0, 2.2 + 0.14, -0.3], [W, 4.4, D - 0.6], pal.wall);
      gbox([0, 1.9, FZ - 0.9 + 0.02], [W - 1.6, 2.6, 0.1], pal.glass); // shop window
      box([0, 4.55, -0.3], [W + 0.3, 0.3, D - 0.3], pal.trim); // parapet
      if (L >= 1) for (let i = 0; i < 6; i++) box([-3.75 + i * 1.5, 3.55, FZ + 0.1], [1.5, 0.12, 1.7], i % 2 ? pal.trim : pal.accent, { rotX: 0.35 }); // striped awning
      if (L >= 1) props.push({ asset: 'parasol-a', x: -3.2, z: FZ + 3.2, r: r() * 6 }, { asset: 'parasol-b', x: 3.2, z: FZ + 3.2, r: r() * 6 });
      break;
    }
    case 'shop': {
      height = 4.8;
      box([0, 2.4 + 0.14, -0.3], [W, 4.8, D - 0.6], pal.wall);
      gbox([-2.3, 1.8, FZ - 0.9 + 0.02], [3.2, 2.4, 0.1], pal.glass);
      gbox([2.3, 1.8, FZ - 0.9 + 0.02], [3.2, 2.4, 0.1], pal.glass);
      box([0, 4.95, -0.3], [W + 0.3, 0.3, D - 0.3], pal.trim);
      if (L >= 1) props.push({ asset: 'display-fruit', x: -3.4, z: FZ + 1.6, r: 0 }, { asset: 'shopping-cart', x: 3.6, z: FZ + 1.8, r: r() * 6 });
      if (L >= 2) props.push({ asset: 'display-bread', x: -1.8, z: FZ + 1.6, r: 0 }, { asset: 'bottle-return', x: 4.2, z: FZ - 0.2, r: 0 });
      break;
    }
    case 'warehouse': {
      height = 6.2;
      box([0, 2.6 + 0.14, -0.3], [W, 5.2, D - 0.6], pal.wall);
      solid.push({ kind: 'hcyl', p: [0, 5.34, -0.3], s: [W / 2 + 0.1, D - 0.4], color: pal.roof, rotY: Math.PI / 2, seg: 10 });
      for (const x of [-2.2, 2.2]) {
        box([x, 1.8, FZ - 0.88], [3, 3.4, 0.12], '#aeb8c4');
        for (let k = 0; k < 5; k++) box([x, 0.5 + k * 0.62, FZ - 0.8], [3, 0.08, 0.06], '#8c98a6'); // roller doors
      }
      props.push({ asset: 'pallet', x: -4.8, z: FZ + 1.2, r: 0.2 }, { asset: 'crate', x: 4.9, z: FZ + 0.8, r: r() * 6 });
      if (L >= 1) props.push({ asset: 'crate', x: 4.6, z: FZ + 2.1, r: r() * 6, s: 0.8 });
      if (L >= 2) props.push({ asset: 'car-delivery', x: 6.8, z: FZ - 3.2, r: 0 });
      break;
    }
    case 'lab': {
      height = 7.6;
      box([0, 0.7, -0.3], [W, 1.2, D - 0.6], pal.trim);
      gbox([0, 4.1, -0.3], [W - 0.2, 5.6, D - 0.8], pal.glass);
      for (let i = 0; i < 7; i++) box([-3.9 + i * 1.3, 4.1, FZ - 0.85], [0.16, 5.6, 0.25], pal.wall); // vertical fins
      box([0, 7.05, -0.3], [W + 0.2, 0.3, D - 0.4], pal.roof);
      if (L >= 2) { solid.push({ kind: 'cyl', p: [2.8, 8.6, -1.6], s: [0.06, 2.8, 0.06], color: '#9aa3b2' }); solid.push({ kind: 'sphere', p: [2.8, 10.1, -1.6], s: [0.25], color: pal.accent }); }
      if (L >= 1) props.push({ asset: 'vending', x: 4.9, z: FZ + 0.6, r: 0 });
      if (L >= 2) for (const x of [-3, -1.2]) box([x, 7.5, -1.5], [1.6, 0.1, 1.1], '#2c3e66', { rotX: -0.4 }); // solar panels
      break;
    }
    case 'academy': {
      height = 7.2;
      box([0, 3.6 + 0.14, -0.9], [W, 7.2, D - 1.8], pal.wall);
      for (const y of [2.2, 5.2]) for (const x of [-3, -1, 1, 3]) gbox([x, y, FZ - 1.78], [1.2, 1.5, 0.1], pal.glass);
      box([0, 7.5, -0.9], [W + 0.3, 0.3, D - 1.5], pal.roof);
      if (L >= 1) { for (const x of [-3.4, -1.15, 1.15, 3.4]) solid.push({ kind: 'cyl', p: [x, 2.5, FZ - 0.3], s: [0.22, 4.8, 0.26], color: pal.trim, seg: 10 }); box([0, 5.0, FZ - 0.6], [W, 0.4, 2.1], pal.trim); }
      if (L >= 2) solid.push({ kind: 'cyl', p: [0, 6.2, FZ - 1.7], s: [0.8, 0.12, 0.8], color: pal.accent, rotX: Math.PI / 2, seg: 16 });
      if (L >= 1) props.push({ asset: 'bench', x: -3.5, z: FZ + 2.4, r: Math.PI }, { asset: 'bench', x: 3.5, z: FZ + 2.4, r: Math.PI });
      break;
    }
    case 'clinic': {
      height = 6.2;
      box([0, 3 + 0.14, -0.3], [W, 6, D - 0.6], pal.wall);
      box([0, 3.1, FZ - 0.88], [W + 0.05, 0.4, 0.06], pal.accent);
      for (const x of [-3, 3]) for (const y of [1.7, 4.4]) gbox([x, y, FZ - 0.88], [1.8, 1.3, 0.1], pal.glass);
      box([0, 6.25, -0.3], [W + 0.2, 0.25, D - 0.4], pal.roof);
      if (L >= 1) { gbox([0, 4.6, FZ - 0.8], [0.5, 1.6, 0.14], pal.accent); gbox([0, 4.6, FZ - 0.8], [1.6, 0.5, 0.14], pal.accent); }
      if (L >= 1) props.push({ asset: 'bench', x: -3.4, z: FZ + 2.2, r: Math.PI });
      break;
    }
    case 'pavilion': {
      height = 5.4;
      solid.push({ kind: 'cyl', p: [0, 0.4, 0], s: [4, 0.5, 4.2], color: pal.trim, seg: 12 });
      glow.push({ kind: 'cyl', p: [0, 2.7, 0], s: [3.5, 4, 3.5], color: pal.glass, seg: 12 });
      solid.push({ kind: 'cyl', p: [0, 4.95, 0], s: [4.4, 0.5, 4.2], color: pal.roof, seg: 12 });
      break;
    }
  }

  // door and sign
  if (preset !== 'pavilion') {
    box([0, 1.3, FZ - 0.84], [1.6, 2.4, 0.12], '#36404d');
    const signY = Math.min(height - 0.6, 3.5);
    if (L >= 1) gbox([0, signY, FZ - 0.78], [3.4, 0.6, 0.12], pal.accent);
    else box([0, signY, FZ - 0.78], [3.4, 0.6, 0.12], '#b8c0ca');
  }

  // ---- readiness layers ----
  if (L === 0) {
    // scaffolding and cones: "the task is missing details"
    for (const [x, z] of [[-W / 2 - 0.3, FZ + 0.1], [W / 2 + 0.3, FZ + 0.1], [-W / 2 - 0.3, -FZ], [W / 2 + 0.3, -FZ]]) solid.push({ kind: 'cyl', p: [x, height / 2 + 0.6, z], s: [0.07, height + 1.2, 0.07], color: '#c9a227', seg: 5 });
    for (const y of [height * 0.45, height + 0.5]) box([0, y, FZ + 0.1], [W + 0.6, 0.1, 0.1], '#c9a227');
    box([0, height + 0.5, 0], [0.1, 0.1, D], '#c9a227');
    props.push({ asset: 'cone', x: -2.2, z: FZ + 1.8, r: 0 }, { asset: 'cone', x: 2.4, z: FZ + 2.3, r: 0 });
  }
  if (L >= 1) {
    for (const x of [-2.1, 2.1]) {
      box([x, 0.45, FZ + 0.9], [1.1, 0.6, 1.1], '#e7e2d8');
      solid.push({ kind: 'sphere', p: [x, 1.05, FZ + 0.9], s: [0.55], color: '#5aa64a' });
    }
  }
  if (L >= 2) {
    box([0, 2.85, FZ + 0.25], [3.6, 0.16, 1.9], pal.accent); // canopy over the entrance
    box([0, 0.2, FZ + 1.9], [3, 0.12, 2.2], '#cfd5dc');
    if (preset !== 'pavilion') box([-2.2, height + 0.5, -1.8], [1.4, 0.7, 1.4], '#b8c0ca'); // rooftop equipment
  }
  if (L >= 3) {
    for (const x of [-4.2, 4.2]) {
      solid.push({ kind: 'cyl', p: [x, 2.6, FZ + 1.4], s: [0.06, 5.2, 0.06], color: '#e5e7eb', seg: 5 });
      box([x + 0.55, 4.6, FZ + 1.4], [1.0, 0.7, 0.04], pal.accent);
    }
    box([0, 0.16, FZ + 2.6], [1.8, 0.04, 3.4], '#b91c1c'); // red carpet
    if (preset !== 'pavilion') { box([0, height + 0.16, -0.3], [W + 0.5, 0.12, 0.12], '#f5c542'); }
  }

  return { solid, glow, props, height, flagAt: [W / 2 + 1.2, FZ + 1.6] };
}

/** Main pavilion at the plaza center: a round glass pavilion with a readiness core (spec 5.5 nodes are kept in the component). */
export function generatePavilion(level: LevelKey): BuildingSpec {
  const L = LEVEL_INDEX[level];
  const solid: Part[] = [];
  const glow: Part[] = [];
  const props: LocalProp[] = [];
  solid.push({ kind: 'cyl', p: [0, 0.2, 0], s: [4.1, 0.4, 4.3], color: '#f4f1ea', seg: 6 });
  solid.push({ kind: 'cyl', p: [0, 0.47, 0], s: [3.7, 0.14, 3.8], color: '#e2ddd2', seg: 6 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    solid.push({ kind: 'box', p: [Math.cos(a) * 3.35, 2.4, Math.sin(a) * 3.35], s: [0.28, 3.8, 0.28], color: '#ffffff', rotY: -a });
  }
  if (L >= 1) solid.push({ kind: 'cyl', p: [0, 4.45, 0], s: [4.0, 0.3, 3.9], color: '#ffffff', seg: 6 });
  if (L >= 1) solid.push({ kind: 'cone', p: [0, 5.05, 0], s: [3.7, 0.9, 3.7], color: L >= 3 ? '#7b3fe4' : L === 2 ? '#2f9e44' : '#2d8fbf', seg: 6 });
  else solid.push({ kind: 'cyl', p: [0, 4.45, 0], s: [4.0, 0.12, 3.9], color: '#c9cfd6', seg: 6 }); // slab without a roof
  glow.push({ kind: 'ring', p: [0, 0.56, 0], s: [3.5, 3.72], color: L >= 2 ? '#7cf2e4' : '#bfe9e3', seg: 6 });
  if (L === 0) props.push({ asset: 'cone', x: 3.6, z: 3.6, r: 0 }, { asset: 'cone', x: -3.8, z: 3.2, r: 0 });
  if (L >= 3) solid.push({ kind: 'oct', p: [0, 6.1, 0], s: [0.45], color: '#f5c542' });
  return { solid, glow, props, height: 5.6, flagAt: [3.9, 3.2] };
}
