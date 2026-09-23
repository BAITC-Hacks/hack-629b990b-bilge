// Campus layout: determinism, stable spots, no overlaps, collisions, interpolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildLayout, placeTasks, presetFor, resolveCollisions, insideRect, PLOTS, ROAD_IN, ROAD_OUT, PLAZA } = await import('../src/3d/world/WorldLayout.ts');
const { InterpBuffer } = await import('../src/3d/multiplayer/NetworkInterpolation.ts');

// synthetic catalog cards (WorldTask shape: id, industry, score.total, publishedAt)
const INDUSTRIES = ['Food service', 'Retail', 'Logistics', 'IT', 'Education', 'Healthcare', 'Other'];
const tasks = Array.from({ length: 35 }, (_, i) => ({
  id: `task-${i}`,
  industry: INDUSTRIES[i % INDUSTRIES.length],
  score: { total: (i * 37) % 101 },
  publishedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
}));
const teams = ['demo-team-1', 'demo-team-2', 'demo-team-3', 'demo-team-4', 'demo-team-5'];

test('building style from free-text BFF industry (English)', () => {
  assert.equal(presetFor('Food service'), 'cafe');
  assert.equal(presetFor('Retail'), 'shop');
  assert.equal(presetFor('Logistics'), 'warehouse');
  assert.equal(presetFor('IT'), 'lab');
  assert.equal(presetFor('Education'), 'academy');
  assert.equal(presetFor('Healthcare'), 'clinic');
  assert.equal(presetFor('Something new'), 'pavilion');
});

test('building style from free-text BFF industry (Russian input still supported)', () => {
  assert.equal(presetFor('Общепит'), 'cafe');
  assert.equal(presetFor('Торговля'), 'shop');
  assert.equal(presetFor('Образование'), 'academy');
  assert.equal(presetFor('Что-то новое'), 'pavilion');
});

test('every task gets a spot; recomputing yields the same coordinates', () => {
  const a = buildLayout(tasks, teams), b = buildLayout(tasks, teams);
  assert.equal(a.placements.length, tasks.length);
  assert.deepEqual(a.placements.map((p) => [p.taskId, p.x, p.z, p.rot]), b.placements.map((p) => [p.taskId, p.x, p.z, p.rot]));
  assert.deepEqual(a.props, b.props, 'decor is deterministic too');
});

test('the center holds the best tasks; a new task does not shift existing buildings', () => {
  const before = placeTasks(tasks);
  const featured = before.filter((p) => p.featured);
  assert.ok(featured.length > 0 && featured.length <= 8);
  const fresh = { id: 'task-new-xyz', industry: 'Retail', score: { total: 12 }, publishedAt: new Date(Date.UTC(2026, 9, 1)).toISOString() };
  const after = placeTasks([...tasks, fresh]);
  for (const p of before) assert.equal(after.find((x) => x.taskId === p.taskId)!.plot.id, p.plot.id, `task ${p.taskId} stayed in place`);
  assert.ok(after.find((x) => x.taskId === 'task-new-xyz'));
});

test('plots do not overlap each other, the road or the plaza', () => {
  const layout = buildLayout(tasks, teams);
  const used = layout.placements.filter((p) => !p.featured);
  for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) {
    assert.ok(Math.hypot(used[i].x - used[j].x, used[i].z - used[j].z) >= 11, `${used[i].plot.id} and ${used[j].plot.id} are too close`);
  }
  assert.equal(new Set(layout.placements.map((p) => p.plot.id)).size, layout.placements.length, 'one plot — one task');
  for (const p of PLOTS.filter((x) => x.kind !== 'featured')) assert.ok(Math.max(Math.abs(p.x), Math.abs(p.z)) - Math.max(p.w, p.d) / 2 > ROAD_OUT + 2, `plot ${p.id} does not reach the road`);
  for (const p of PLOTS.filter((x) => x.kind === 'featured')) assert.ok(Math.max(Math.abs(p.x), Math.abs(p.z)) < PLAZA - 4 && Math.hypot(p.x, p.z) > 10);
  assert.ok(ROAD_IN > PLAZA, 'the road surrounds the plaza and does not cross it');
  for (const s of layout.teamSlots) for (const p of used) assert.ok(Math.hypot(s.x - p.x, s.z - p.z) > 10, 'team bases are not on task plots');
});

test('collisions: the player cannot walk through a task building and stays within bounds', () => {
  const layout = buildLayout(tasks, teams);
  const b = layout.placements.find((p) => !p.featured)!;
  const c = layout.colliders.find((x) => x.tag === `task:${b.taskId}`)!;
  const [x, z] = resolveCollisions(b.x, b.z, layout.colliders);
  assert.equal(c.kind, 'rect');
  assert.equal(insideRect(x, z, c as never), false);
  const [ex, ez] = resolveCollisions(500, -500, [], 0.45, layout.walkLimit);
  assert.equal(ex, layout.walkLimit); assert.equal(ez, -layout.walkLimit);
});

test('remote player interpolation: smooth between packets, no extrapolation', () => {
  const buf = new InterpBuffer();
  buf.push({ t: 0, x: 0, z: 0, r: 0 });
  buf.push({ t: 100, x: 10, z: 0, r: 0 });
  assert.equal(buf.sample(50)!.x, 5);
  assert.equal(buf.sample(500)!.x, 10);
  assert.equal(buf.sample(-10)!.x, 0);
});
