// Детерминированная планировка кампуса «AI Sana». Чистые вычисления без three.js — покрыты автотестами.
//
// Слои от центра (как на референсе Creator Academy Plaza / low-poly campus):
//   монумент TRIUMPH → кольцо главных павильонов задач → пешеходная площадь с зелёными островками
//   → тротуар → кольцевая дорога (не пересекает площадь) → тротуар → кварталы районов с участками задач
//   → резервный ряд участков → живая изгородь → высокие здания и горы только на заднем плане.
// Каждая задача получает место по seed = hash(task.id): одинаково после перезагрузки и у всех игроков.
import { WORLD_HALF, hash32, rng } from '../../shared/world';

export type District = 'central' | 'business' | 'innovation' | 'green' | 'teams';
export const DISTRICT_LABEL: Record<District, string> = {
  central: 'Triumph Plaza', business: 'Бизнес-квартал', innovation: 'Инновационный квартал', green: 'Зелёный квартал', teams: 'Квартал команд',
};

export const PLAZA = 30;          // половина стороны пешеходной площади
export const ROAD_IN = 33;        // внутренний край дороги
export const ROAD_OUT = 41;       // внешний край дороги
export const SIDEWALK_OUT = 44;   // конец внешнего тротуара
export const BAND_OUT = 74;       // внешний край основных кварталов
export const FEATURED_R = 17.5;   // радиус кольца главных павильонов
export const FEATURED_SLOTS = 8;
export const PLOT_W = 11;         // участок вдоль улицы
export const PLOT_D = 10;         // участок в глубину
export const BUILDING_W = 9;
export const BUILDING_D = 8;
export const PAVILION_R = 4.2;
export const FOUNTAINS: [number, number][] = [[-13, 25], [13, 25]];
export const FOUNTAIN_R = 3.3;
export const MONUMENT_PYLONS: [number, number][] = [[-5.2, 0], [5.2, 0]];
export const HALL_POS = { x: -25.5, z: 9, rot: Math.PI / 2 };
export const LANE_D = 57.5;
export const LANE2_D = 72.5;

export type Side = 'N' | 'E' | 'S' | 'W';
const SIDE_DISTRICT: Record<Side, District> = { N: 'business', E: 'innovation', S: 'teams', W: 'green' };
const SIDE_ROT: Record<Side, number> = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 };

/** Локальные координаты квартала (t — вдоль улицы, d — от центра) → мир. */
export function sideToWorld(side: Side, t: number, d: number): [number, number] {
  switch (side) {
    case 'N': return [t, -d];
    case 'S': return [-t, d];
    case 'E': return [d, t];
    case 'W': return [-d, -t];
  }
}

export interface Plot { id: string; x: number; z: number; rot: number; w: number; d: number; district: District; kind: 'featured' | 'plot' | 'reserve'; rank: number }
export type Collider = { kind: 'circle'; x: number; z: number; r: number; tag: string } | { kind: 'rect'; x: number; z: number; hw: number; hd: number; rot: number; tag: string };
export type BuildingPreset = 'cafe' | 'shop' | 'warehouse' | 'lab' | 'academy' | 'clinic' | 'pavilion';
export interface TaskPlacement { taskId: string; plot: Plot; x: number; z: number; rot: number; featured: boolean; seed: number; preset: BuildingPreset; district: District }
export interface TeamSlot { teamId: string; x: number; z: number; rot: number; index: number }
export interface Placement { x: number; z: number; r: number; s?: number; y?: number }
export interface DecorBuilding { asset: string; x: number; z: number; rot: number; s: number; w: number; d: number }
export interface Planter { x: number; z: number; w: number; d: number; rot: number; tree: boolean }
export interface FlowerBed { x: number; z: number; r: number; color: string }
export interface Path { x: number; z: number; w: number; d: number; rot: number; kind: 'axis' | 'lane' | 'plot' | 'square' }
export interface Route { id: string; points: [number, number][]; loop: boolean }

export interface TaskLike { id: string; industry: string; score: { total: number }; publishedAt: string }

export interface WorldLayout {
  plots: Plot[];
  placements: TaskPlacement[];
  byTask: Record<string, TaskPlacement>;
  teamSlots: TeamSlot[];
  byTeam: Record<string, TeamSlot>;
  colliders: Collider[];
  props: Record<string, Placement[]>;
  decorBuildings: DecorBuilding[];
  farBuildings: DecorBuilding[];
  planters: Planter[];
  flowerBeds: FlowerBed[];
  bins: Placement[];
  paths: Path[];
  routes: Route[];
  benches: Placement[];
  reserveUsed: boolean;
  /** Граница прогулки (живая изгородь). */
  walkLimit: number;
  /** Линия изгороди; за ней лесополоса и задний план. */
  edge: number;
}

export const INDUSTRY_PRESET: Record<string, BuildingPreset> = {
  HoReCa: 'cafe', 'Ритейл': 'shop', 'Логистика': 'warehouse', 'Финтех': 'lab', 'Образование': 'academy', 'Здравоохранение': 'clinic',
};
const INDUSTRY_DISTRICTS: Record<string, District[]> = {
  HoReCa: ['business', 'green', 'innovation'], 'Ритейл': ['business', 'innovation', 'green'],
  'Логистика': ['innovation', 'business', 'green'], 'Финтех': ['innovation', 'business', 'green'],
  'Образование': ['green', 'innovation', 'business'], 'Здравоохранение': ['green', 'business', 'innovation'],
};
const ANY: District[] = ['business', 'innovation', 'green'];

// ---------- фиксированная сетка участков ----------
function buildPlots(): Plot[] {
  const plots: Plot[] = [];
  // главные павильоны: кольцо вокруг монумента, южный сектор свободен (главный вход и вид со стартовой камеры)
  const order = [3, 4, 2, 5, 1, 6, 0, 7];
  for (let k = 0; k < FEATURED_SLOTS; k++) {
    const a = ((25 + k * (310 / 7)) * Math.PI) / 180;
    const x = FEATURED_R * Math.sin(a), z = FEATURED_R * Math.cos(a);
    plots.push({ id: `featured-${k}`, x, z, rot: Math.atan2(-x, -z), w: PAVILION_R * 2, d: PAVILION_R * 2, district: 'central', kind: 'featured', rank: order.indexOf(k) });
  }
  // кварталы N/E/W: передний ряд (к дороге), задний ряд (к аллее), резервный ряд (растёт по числу задач)
  let rank = 0;
  for (const side of ['N', 'E', 'W'] as Side[]) {
    const district = SIDE_DISTRICT[side];
    for (const [row, d, ts] of [['plot', 50, [-21, 21, -35, 35]], ['plot', 65, [-21, 21, -35, 35]], ['reserve', 80, [-7, 7, -21, 21, -35, 35]]] as const) {
      for (const t of ts) {
        const [x, z] = sideToWorld(side, t, d);
        plots.push({ id: `${side}-${d}-${t}`, x, z, rot: SIDE_ROT[side], w: PLOT_W, d: PLOT_D, district, kind: row, rank: rank++ });
      }
    }
  }
  // угловые кварталы: по два участка лицом к ближайшей дороге (юго-западный угол занят скейт-площадкой)
  const corners: [number, number, District][] = [[1, -1, 'business'], [-1, -1, 'green'], [1, 1, 'innovation']];
  for (const [sx, sz, district] of corners) {
    plots.push({ id: `C${sx}${sz}-a`, x: sx * 52, z: sz * 66, rot: sz > 0 ? Math.PI : 0, w: PLOT_W, d: PLOT_D, district, kind: 'plot', rank: rank++ });
    plots.push({ id: `C${sx}${sz}-b`, x: sx * 66, z: sz * 52, rot: sx > 0 ? -Math.PI / 2 : Math.PI / 2, w: PLOT_W, d: PLOT_D, district, kind: 'plot', rank: rank++ });
  }
  return plots;
}
export const PLOTS: Plot[] = buildPlots();

/** Слоты баз команд (квартал команд на юге), ближние к площади — первыми. */
export const TEAM_SLOTS: { x: number; z: number; rot: number }[] = ([[50, -21], [50, 21], [50, -35], [50, 35], [65, -21], [65, 21], [65, -35], [65, 35]] as const).map(([d, t]) => {
  const [x, z] = sideToWorld('S', t, d);
  return { x, z, rot: Math.PI };
});
export const TEAM_BASE_R = 5;

// ---------- размещение задач ----------
export function placeTasks(tasks: TaskLike[]): TaskPlacement[] {
  // главные: лучшие по готовности (порядок каталога), ранг → самый заметный слот
  const ranked = [...tasks].sort((a, b) => b.score.total - a.score.total || b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  const featured = ranked.slice(0, Math.min(FEATURED_SLOTS, ranked.length));
  const featuredSet = new Set(featured.map((t) => t.id));
  const featuredPlots = PLOTS.filter((p) => p.kind === 'featured').sort((a, b) => a.rank - b.rank);
  const out: TaskPlacement[] = featured.map((t, i) => mk(t, featuredPlots[i], true));

  // остальные — в порядке публикации: новая задача не сдвигает старые
  const rest = tasks.filter((t) => !featuredSet.has(t.id)).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const pool = PLOTS.filter((p) => p.kind !== 'featured');
  const extra: Plot[] = [];
  for (const t of rest) {
    const seed = hash32(t.id);
    const prefs = INDUSTRY_DISTRICTS[t.industry] ?? ANY;
    let plot: Plot | undefined;
    for (const kind of ['plot', 'reserve'] as const) {
      for (const d of prefs) {
        const free = pool.filter((p) => p.kind === kind && p.district === d && !used.has(p.id));
        if (free.length) { plot = free[seed % free.length]; break; }
      }
      if (plot) break;
    }
    if (!plot) plot = overflowPlot(extra.length);
    if (plot.id.startsWith('overflow')) extra.push(plot);
    used.add(plot.id);
    out.push(mk(t, plot, false));
  }
  return out;
}
/** Если задач больше, чем участков: дополнительное кольцо за резервным рядом (мир продолжает расти). */
function overflowPlot(i: number): Plot {
  const sides: Side[] = ['N', 'E', 'W', 'S'];
  const side = sides[i % 4];
  const k = Math.floor(i / 4);
  const t = -35 + (k % 6) * 14;
  const d = 80 + 13 * (1 + Math.floor(k / 6));
  const [x, z] = sideToWorld(side, t, d);
  return { id: `overflow-${i}`, x, z, rot: SIDE_ROT[side], w: PLOT_W, d: PLOT_D, district: SIDE_DISTRICT[side], kind: 'reserve', rank: 1000 + i };
}
function mk(t: TaskLike, plot: Plot, featured: boolean): TaskPlacement {
  const seed = hash32(t.id);
  const r = rng(seed);
  const jitter = featured ? 0 : (r() - 0.5) * 0.12; // лёгкий поворот, чтобы кварталы не выглядели штампом
  return { taskId: t.id, plot, x: plot.x, z: plot.z, rot: plot.rot + jitter, featured, seed, preset: featured ? 'pavilion' : INDUSTRY_PRESET[t.industry] ?? 'pavilion', district: plot.district };
}

export function districtAt(x: number, z: number): District {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax <= ROAD_OUT && az <= ROAD_OUT) return 'central';
  if (az >= ax) return z < 0 ? (x > SIDEWALK_OUT ? 'business' : x < -SIDEWALK_OUT ? 'green' : 'business') : (x > SIDEWALK_OUT ? 'innovation' : 'teams');
  return x > 0 ? 'innovation' : 'green';
}

// ---------- геометрия проверки ----------
export function insideRect(px: number, pz: number, c: { x: number; z: number; hw: number; hd: number; rot: number }, pad = 0): boolean {
  const dx = px - c.x, dz = pz - c.z;
  const cos = Math.cos(-c.rot), sin = Math.sin(-c.rot);
  const lx = dx * cos + dz * sin, lz = -dx * sin + dz * cos;
  return Math.abs(lx) <= c.hw + pad && Math.abs(lz) <= c.hd + pad;
}

/** Выталкивание точки (игрока радиуса r) из препятствий. Возвращает исправленную позицию. */
export function resolveCollisions(x: number, z: number, colliders: Collider[], r = 0.45, half = WORLD_HALF): [number, number] {
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      if (c.kind === 'circle') {
        const dx = x - c.x, dz = z - c.z;
        const d = Math.hypot(dx, dz), min = c.r + r;
        if (d < min) {
          if (d < 1e-5) { x = c.x + min; continue; }
          x = c.x + (dx / d) * min; z = c.z + (dz / d) * min;
        }
      } else {
        const dx = x - c.x, dz = z - c.z;
        const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
        // мир → локальные оси прямоугольника (rotation-y)
        const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
        const hx = c.hw + r, hz = c.hd + r;
        if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
          const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
          let nx = lx, nz = lz;
          if (px < pz) nx = Math.sign(lx || 1) * hx; else nz = Math.sign(lz || 1) * hz;
          x = c.x + nx * cos + nz * sin;
          z = c.z - nx * sin + nz * cos;
        }
      }
    }
  }
  return [Math.max(-half, Math.min(half, x)), Math.max(-half, Math.min(half, z))];
}

// ---------- полная планировка ----------
export function buildLayout(tasks: TaskLike[], teamIds: string[]): WorldLayout {
  const placements = placeTasks(tasks);
  const byTask: Record<string, TaskPlacement> = Object.fromEntries(placements.map((p) => [p.taskId, p]));
  const teamSlots: TeamSlot[] = teamIds.map((teamId, i) => {
    const s = TEAM_SLOTS[i] ?? (() => { const [x, z] = sideToWorld('S', -7 + (i - TEAM_SLOTS.length) * 14, 80); return { x, z, rot: Math.PI }; })();
    return { teamId, ...s, index: i };
  });
  const byTeam: Record<string, TeamSlot> = Object.fromEntries(teamSlots.map((s) => [s.teamId, s]));
  const reserveUsed = placements.some((p) => p.plot.kind === 'reserve');

  const colliders: Collider[] = [];
  const props: Record<string, Placement[]> = {};
  const put = (id: string, p: Placement) => { (props[id] ??= []).push(p); };
  const benches: Placement[] = [];
  const bins: Placement[] = [];
  const planters: Planter[] = [];
  const flowerBeds: FlowerBed[] = [];
  const paths: Path[] = [];
  const decorBuildings: DecorBuilding[] = [];
  const farBuildings: DecorBuilding[] = [];
  const R = rng(20260923);

  // здания задач и павильоны
  for (const p of placements) {
    if (p.featured) colliders.push({ kind: 'circle', x: p.x, z: p.z, r: PAVILION_R, tag: `task:${p.taskId}` });
    else colliders.push({ kind: 'rect', x: p.x, z: p.z, hw: BUILDING_W / 2, hd: BUILDING_D / 2, rot: p.rot, tag: `task:${p.taskId}` });
  }
  // монумент и фонтаны
  for (const [x, z] of MONUMENT_PYLONS) colliders.push({ kind: 'rect', x, z, hw: 1.5, hd: 1.4, rot: 0, tag: 'monument' });
  colliders.push({ kind: 'circle', x: 0, z: 0, r: 2.2, tag: 'monument-core' });
  for (const [x, z] of FOUNTAINS) colliders.push({ kind: 'circle', x, z, r: FOUNTAIN_R, tag: 'fountain' });
  colliders.push({ kind: 'rect', x: HALL_POS.x, z: HALL_POS.z, hw: 3.2, hd: 0.6, rot: HALL_POS.rot, tag: 'hall' });

  // ---- площадь: зелёные островки между павильонами, лавочки лицом к монументу ----
  const featuredAngles = Array.from({ length: FEATURED_SLOTS }, (_, k) => 25 + k * (310 / 7));
  for (let k = 0; k < FEATURED_SLOTS - 1; k++) {
    const a = ((featuredAngles[k] + featuredAngles[k + 1]) / 2 * Math.PI) / 180;
    const x = 26.5 * Math.sin(a), z = 26.5 * Math.cos(a);
    const rot = Math.atan2(-x, -z);
    planters.push({ x, z, w: 4.2, d: 2.6, rot, tree: true });
    colliders.push({ kind: 'rect', x, z, hw: 2.1, hd: 1.3, rot, tag: 'planter' });
    const bx = x - Math.sin(rot) * 2.3, bz = z - Math.cos(rot) * 2.3;
    benches.push({ x: bx, z: bz, r: rot });
  }
  // угловые островки площади
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = sx * 24.5, z = sz * 24.5;
    planters.push({ x, z, w: 6, d: 6, rot: Math.PI / 4, tree: true });
    colliders.push({ kind: 'circle', x, z, r: 3.6, tag: 'planter' });
    flowerBeds.push({ x: x - sx * 4.6, z: z - sz * 1.2, r: 1.1, color: '#f28ab2' }, { x: x - sx * 1.2, z: z - sz * 4.6, r: 1.1, color: '#ffd166' });
  }
  // клумбы вдоль южного входа
  for (const sx of [-1, 1]) for (const z of [22.5, 28]) flowerBeds.push({ x: sx * 4.6, z, r: 1.1, color: z > 25 ? '#9b8cf2' : '#ff9f68' });
  for (const [x, z] of FOUNTAINS) for (const k of [0, 1, 2]) { const a = k * 2.1 + 0.6; bins.push({ x: x + Math.cos(a) * 5.2, z: z + Math.sin(a) * 5.2, r: 0 }); }

  // ---- фонари и светофоры ----
  for (const side of ['N', 'E', 'S', 'W'] as Side[]) {
    for (let t = -26; t <= 26; t += 10.4) {
      if (Math.abs(t) < 6) continue;
      const [x, z] = sideToWorld(side, t, 32.3);
      put('streetlight', { x, z, r: SIDE_ROT[side] + Math.PI });
      colliders.push({ kind: 'circle', x, z, r: 0.3, tag: 'lamp' });
    }
    for (let t = -38; t <= 38; t += 12.6) {
      if (Math.abs(t) < 7) continue;
      const [x, z] = sideToWorld(side, t, 41.7);
      put('streetlight', { x, z, r: SIDE_ROT[side] });
      colliders.push({ kind: 'circle', x, z, r: 0.3, tag: 'lamp' });
    }
    for (const t of [-5.4, 5.4]) {
      const [x, z] = sideToWorld(side, t, 41.7);
      put('trafficlight-a', { x, z, r: SIDE_ROT[side] });
      const [x2, z2] = sideToWorld(side, -t, 32.3);
      put('trafficlight-a', { x: x2, z: z2, r: SIDE_ROT[side] + Math.PI });
    }
    const [hx, hz] = sideToWorld(side, 14, 42.9);
    put('hydrant', { x: hx, z: hz, r: 0 });
  }

  // ---- кварталы: дорожки, аллея, особые места ----
  for (const side of ['N', 'E', 'S', 'W'] as Side[]) {
    const rot = SIDE_ROT[side];
    const [ax, az] = sideToWorld(side, 0, (SIDEWALK_OUT + (reserveUsed ? 77 : 70)) / 2);
    const axisLen = (reserveUsed ? 77 : 70) - SIDEWALK_OUT;
    paths.push({ x: ax, z: az, w: 6, d: axisLen, rot, kind: 'axis' });
    const [lx, lz] = sideToWorld(side, 0, LANE_D);
    paths.push({ x: lx, z: lz, w: 94, d: 4, rot, kind: 'lane' });
    if (reserveUsed && side !== 'S') { const [l2x, l2z] = sideToWorld(side, 0, LANE2_D); paths.push({ x: l2x, z: l2z, w: 94, d: 4, rot, kind: 'lane' }); }
    // площадка у входа в квартал (между передними участками)
    const [sqx, sqz] = sideToWorld(side, 0, 50);
    paths.push({ x: sqx, z: sqz, w: 20, d: 9, rot, kind: 'square' });
  }
  // дорожки ко входам зданий задач
  for (const p of placements) {
    if (p.featured) continue;
    const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
    const len = p.plot.kind === 'plot' && isFrontRow(p.plot) ? 2.6 : 3.2;
    paths.push({ x: p.x + fx * (BUILDING_D / 2 + len / 2), z: p.z + fz * (BUILDING_D / 2 + len / 2), w: 3.2, d: len, rot: p.rot, kind: 'plot' });
  }

  // квартал бизнеса: зонтики, киоски; инновации: техно-стенды; зелёный: пруд; команды: скейт-площадка
  landmarkProps(put, colliders, benches, R);

  // средние здания — рамка углов (не больше трёх вблизи)
  const mids: [number, number, string][] = [[64, -64, 'bld-l'], [-64, -64, 'bld-n'], [64, 64, 'bld-j']];
  for (const [x, z, id] of mids) {
    const rot = Math.atan2(-x, -z);
    decorBuildings.push({ asset: id, x, z, rot, s: 1.05, w: 14, d: 13 });
    colliders.push({ kind: 'rect', x, z, hw: 7.5, hd: 7, rot, tag: 'building' });
  }

  // ---- равномерное заполнение пустот мелкими объектами ----
  // Каждая клетка сетки имеет свой seed: когда на участке появляется здание, исчезают только объекты этого участка,
  // остальная декорация не «переезжает».
  const baseColliders = [...colliders];
  const blocked = (x: number, z: number, pad: number) => {
    for (const c of baseColliders) {
      if (c.kind === 'circle' ? Math.hypot(x - c.x, z - c.z) < c.r + pad : insideRect(x, z, c, pad)) return true;
    }
    for (const pa of paths) if (insideRect(x, z, { x: pa.x, z: pa.z, hw: pa.w / 2, hd: pa.d / 2, rot: pa.rot }, pad * 0.6)) return true;
    for (const s of teamSlots) if (Math.hypot(x - s.x, z - s.z) < TEAM_BASE_R + 2.2) return true;
    if (x < -48 && z > 48 && x > -72 && z < 72) return true; // скейт-площадка
    return false;
  };
  const outer = reserveUsed ? 86 : BAND_OUT + 1;
  const step = 5.2;
  for (let gx = -outer; gx <= outer; gx += step) {
    for (let gz = -outer; gz <= outer; gz += step) {
      const R = rng(hash32(`cell:${gx.toFixed(1)}:${gz.toFixed(1)}`));
      const x = gx + (R() - 0.5) * 2.6, z = gz + (R() - 0.5) * 2.6;
      const m = Math.max(Math.abs(x), Math.abs(z));
      if (m < SIDEWALK_OUT + 0.8 || m > outer) continue;
      if (blocked(x, z, 1.6)) continue;
      const k = R();
      const district = districtAt(x, z);
      const green = district === 'green';
      if (k < (green ? 0.5 : 0.36)) {
        const id = R() < 0.4 ? 'tree-high' : R() < 0.5 ? 'tree-round' : 'tree';
        put(id, { x, z, r: R() * Math.PI * 2, s: 1.35 + R() * 0.5 });
        colliders.push({ kind: 'circle', x, z, r: 0.55, tag: 'tree' });
      } else if (k < 0.62) put('bush', { x, z, r: R() * Math.PI * 2, s: 0.9 + R() * 0.5 });
      else if (k < 0.76) flowerBeds.push({ x, z, r: 0.9 + R() * 0.5, color: ['#f28ab2', '#ffd166', '#9b8cf2', '#ff9f68', '#7ad3f7'][Math.floor(R() * 5)] });
      else if (k < 0.88) put(R() < 0.5 ? 'plant' : 'patch-grass', { x, z, r: R() * Math.PI * 2, s: 1.4 });
      else if (k < 0.95) { const r = R() * Math.PI * 2; benches.push({ x, z, r }); }
      else if (green) put('rocks-low', { x, z, r: R() * 6, s: 0.9 });
      else bins.push({ x, z, r: 0 });
    }
  }
  // живая изгородь и лесополоса по краю — естественная граница мира
  const edge = outer + 2;
  for (let t = -edge; t <= edge; t += 2.4) {
    for (const [x, z] of [[t, -edge], [t, edge], [-edge, t], [edge, t]] as [number, number][]) {
      put('bush', { x, z, r: R() * 6, s: 1.2 + R() * 0.3 });
    }
  }
  for (let t = -edge - 6; t <= edge + 6; t += 4.2) {
    for (const [x, z] of [[t, -edge - 5], [t, edge + 5], [-edge - 5, t], [edge + 5, t]] as [number, number][]) {
      put(R() < 0.5 ? 'tree-high' : 'tree', { x: x + (R() - 0.5) * 2, z: z + (R() - 0.5) * 2, r: R() * 6, s: 1.6 + R() * 0.6 });
    }
  }
  // задний план: высокие здания только вдали
  const skyline = ['tower-a', 'tower-b', 'tower-c', 'tower-d', 'tower-e', 'far-a', 'far-b', 'far-c', 'far-d', 'far-e', 'far-f', 'far-g', 'far-h', 'far-i', 'far-j', 'far-wide-a', 'far-wide-b'];
  const ring = edge + 16;
  for (let t = -ring; t <= ring; t += 11) {
    for (const [side, x, z] of [['N', t, -ring], ['S', t, ring], ['W', -ring, t], ['E', ring, t]] as [Side, number, number][]) {
      if (R() < 0.18) continue;
      const id = skyline[Math.floor(R() * skyline.length)];
      const jitter = R() * 14;
      const [px, pz] = side === 'N' ? [x, z - jitter] : side === 'S' ? [x, z + jitter] : side === 'W' ? [x - jitter, z] : [x + jitter, z];
      farBuildings.push({ asset: id, x: px, z: pz, rot: SIDE_ROT[side] + (R() < 0.5 ? 0 : Math.PI / 2), s: 1 + R() * 0.5, w: 0, d: 0 });
    }
  }
  // маршруты декоративных прохожих (NPC)
  const routes: Route[] = [
    { id: 'plaza-ring', points: Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return [Math.sin(a) * 23.2, Math.cos(a) * 23.2] as [number, number]; }), loop: true },
    { id: 'sidewalk', points: [[-43, -43], [43, -43], [43, 43], [-43, 43]], loop: true },
    { id: 'lane-n', points: [[-45, -LANE_D], [45, -LANE_D]], loop: false },
    { id: 'lane-w', points: [[-LANE_D, -45], [-LANE_D, 45]], loop: false },
    { id: 'lane-e', points: [[LANE_D, -45], [LANE_D, 45]], loop: false },
    { id: 'south-axis', points: [[0, 27], [0, 44], [0, 70]], loop: false },
  ];

  return { plots: PLOTS, placements, byTask, teamSlots, byTeam, colliders, props, decorBuildings, farBuildings, planters, flowerBeds, bins, paths, routes, benches, reserveUsed, walkLimit: Math.min(WORLD_HALF, outer + 1), edge };
}

function isFrontRow(p: Plot) { return p.id.includes('-50-') || p.id.endsWith('-a') || p.id.endsWith('-b'); }

/** Особые места кварталов (детерминированно). */
function landmarkProps(put: (id: string, p: Placement) => void, colliders: Collider[], benches: Placement[], R: () => number) {
  // бизнес (север): уличное кафе у входа в квартал
  for (const [t, d] of [[-7, 47.5], [7, 47.5], [-7, 52.5], [7, 52.5]]) {
    const [x, z] = sideToWorld('N', t, d);
    put(R() < 0.5 ? 'parasol-a' : 'parasol-b', { x, z, r: R() * 6 });
  }
  for (const [t, d] of [[-12.5, 48], [12.5, 48]]) { const [x, z] = sideToWorld('N', t, d); put('display-fruit', { x, z, r: 0 }); colliders.push({ kind: 'circle', x, z, r: 0.7, tag: 'prop' }); }
  // инновации (восток): стенды и автоматы
  for (const [t, d, id] of [[-8, 47, 'vending'], [-6.6, 47, 'vending'], [8, 47, 'arcade'], [9.4, 47, 'claw'], [-8.5, 52.5, 'dance'], [8.5, 52.5, 'ticket']] as [number, number, string][]) {
    const [x, z] = sideToWorld('E', t, d);
    put(id, { x, z, r: -Math.PI / 2 });
    colliders.push({ kind: 'circle', x, z, r: 0.6, tag: 'prop' });
  }
  // зелёный (запад): лавочки у пруда (пруд рисуется отдельно в точке sideToWorld('W', 0, 64))
  const [px, pz] = sideToWorld('W', 0, 64);
  colliders.push({ kind: 'circle', x: px, z: pz, r: 5.2, tag: 'pond' });
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k - 2) * 0.55;
    const x = px + Math.cos(a) * 7.2, z = pz + Math.sin(a) * 7.2;
    benches.push({ x, z, r: Math.atan2(px - x, pz - z) });
  }
  // квартал команд (юго-запад): скейт-площадка
  const sk: [string, number, number, number][] = [['half-pipe', -56, 58, Math.PI / 2], ['skate-box', -62, 64, 0], ['skate-rail', -54, 66, 0], ['skate-steps', -66, 56, Math.PI], ['skate-platform', -62, 52, 0]];
  for (const [id, x, z, r] of sk) put(id, { x, z, r });
  put('skateboard', { x: -58.5, z: 62, r: 0.4 });
}
