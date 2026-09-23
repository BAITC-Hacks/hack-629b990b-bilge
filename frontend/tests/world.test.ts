// Планировка кампуса: детерминированность, стабильность мест, отсутствие пересечений, коллизии.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildLayout, placeTasks, resolveCollisions, insideRect, PLOTS, ROAD_IN, ROAD_OUT, PLAZA } = await import('../src/3d/world/WorldLayout.ts');
const { seedState, snapshot } = await import('../src/shared/domain.ts');
const { InterpBuffer } = await import('../src/3d/multiplayer/NetworkInterpolation.ts');

const tasks = snapshot(seedState(), null).tasks;
const teams = seedState().teams.map((t) => t.id);

test('каждая задача получает место; повторный расчёт даёт те же координаты', () => {
  const a = buildLayout(tasks, teams), b = buildLayout(tasks, teams);
  assert.equal(a.placements.length, tasks.length);
  assert.deepEqual(a.placements.map((p) => [p.taskId, p.x, p.z, p.rot]), b.placements.map((p) => [p.taskId, p.x, p.z, p.rot]));
  assert.deepEqual(a.props, b.props, 'декор тоже детерминирован');
});

test('центр — лучшие задачи; новая задача не сдвигает существующие здания', () => {
  const before = placeTasks(tasks);
  const featured = before.filter((p) => p.featured).map((p) => p.taskId);
  assert.ok(featured.length > 0 && featured.length <= 8);
  const fresh = { id: 'task-new-xyz', industry: 'Ритейл', score: { total: 12 }, publishedAt: new Date(Date.now() + 1000).toISOString() };
  const after = placeTasks([...tasks, fresh]);
  for (const p of before) {
    const q = after.find((x) => x.taskId === p.taskId)!;
    assert.equal(q.plot.id, p.plot.id, `задача ${p.taskId} осталась на месте`);
  }
  assert.ok(after.find((x) => x.taskId === 'task-new-xyz'));
});

test('участки не пересекаются друг с другом, с дорогой и площадью', () => {
  const layout = buildLayout(tasks, teams);
  const used = layout.placements.filter((p) => !p.featured);
  for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) {
    assert.ok(Math.hypot(used[i].x - used[j].x, used[i].z - used[j].z) >= 11, `${used[i].plot.id} и ${used[j].plot.id} слишком близко`);
  }
  assert.equal(new Set(layout.placements.map((p) => p.plot.id)).size, layout.placements.length, 'один участок — одна задача');
  for (const p of PLOTS.filter((x) => x.kind !== 'featured')) {
    const m = Math.max(Math.abs(p.x), Math.abs(p.z)) - Math.max(p.w, p.d) / 2;
    assert.ok(m > ROAD_OUT + 2, `участок ${p.id} не заходит на дорогу`);
  }
  for (const p of PLOTS.filter((x) => x.kind === 'featured')) assert.ok(Math.max(Math.abs(p.x), Math.abs(p.z)) < PLAZA - 4 && Math.hypot(p.x, p.z) > 10, 'главные павильоны на площади вокруг монумента');
  assert.ok(ROAD_IN > PLAZA, 'дорога окружает площадь и не пересекает её');
  for (const s of layout.teamSlots) for (const p of used) assert.ok(Math.hypot(s.x - p.x, s.z - p.z) > 10, 'базы команд не на участках задач');
});

test('коллизии: игрок не проходит сквозь здание задачи и остаётся в границах', () => {
  const layout = buildLayout(tasks, teams);
  const b = layout.placements.find((p) => !p.featured)!;
  const c = layout.colliders.find((x) => x.tag === `task:${b.taskId}`)!;
  const [x, z] = resolveCollisions(b.x, b.z, layout.colliders);
  assert.equal(c.kind, 'rect');
  assert.equal(insideRect(x, z, c as any), false);
  const [ex, ez] = resolveCollisions(500, -500, [], 0.45, layout.walkLimit);
  assert.equal(ex, layout.walkLimit); assert.equal(ez, -layout.walkLimit);
});

test('интерполяция удалённого игрока: плавно между пакетами, без экстраполяции', () => {
  const buf = new InterpBuffer();
  buf.push({ t: 0, x: 0, z: 0, r: 0 });
  buf.push({ t: 100, x: 10, z: 0, r: 0 });
  assert.equal(buf.sample(50)!.x, 5);
  assert.equal(buf.sample(500)!.x, 10);
  assert.equal(buf.sample(-10)!.x, 0);
});
