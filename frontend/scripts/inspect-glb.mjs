// Опись скачанных моделей: имя сцены/узлов, анимации, габарит (по accessor min/max POSITION), внешние файлы.
// Запуск: node scripts/inspect-glb.mjs <папка> > models-inventory.txt
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(glb|gltf)$/i.test(f)) out.push(p);
  }
  return out;
}

function readGltf(file) {
  const buf = readFileSync(file);
  if (file.toLowerCase().endsWith('.gltf')) return JSON.parse(buf.toString('utf8'));
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

const root = process.argv[2] ?? 'public/models/raw';
for (const file of walk(root).sort()) {
  try {
    const g = readGltf(file);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const m of g.meshes ?? []) for (const p of m.primitives ?? []) {
      const a = g.accessors?.[p.attributes?.POSITION];
      if (a?.min && a?.max) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a.min[i]); max[i] = Math.max(max[i], a.max[i]); }
    }
    const size = min[0] === Infinity ? '?' : max.map((v, i) => (v - min[i]).toFixed(2)).join('x');
    const names = (g.nodes ?? []).map((n) => n.name).filter(Boolean);
    const anims = (g.animations ?? []).map((a) => a.name).filter(Boolean);
    const ext = [...(g.images ?? []).map((i) => i.uri).filter(Boolean), ...(g.buffers ?? []).map((b) => b.uri).filter((u) => u && !u.startsWith('data:'))];
    const kb = Math.round(statSync(file).size / 1024);
    console.log(`${file} | ${kb}KB | size ${size} | meshes ${(g.meshes ?? []).length} | skins ${(g.skins ?? []).length} | nodes: ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}${anims.length ? ` | anims(${anims.length}): ${anims.slice(0, 14).join(', ')}` : ''}${ext.length ? ` | ext: ${ext.slice(0, 3).join(', ')}` : ''}`);
  } catch (e) {
    console.log(`${file} | ERROR ${e.message}`);
  }
}
