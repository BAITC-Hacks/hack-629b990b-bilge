// Сборка статичной геометрии из примитивов в один меш с цветами вершин (один вызов отрисовки на здание/слой).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type PartKind = 'box' | 'cyl' | 'cone' | 'sphere' | 'hcyl' | 'torus' | 'oct' | 'ring';
export interface Part {
  kind: PartKind;
  /** центр детали (для box/cyl — центр объёма) */
  p: [number, number, number];
  /** box: [w, h, d]; cyl/cone: [rTop, h, rBottom]; sphere/oct: [r]; hcyl: [r, len]; torus: [R, tube]; ring: [rIn, rOut] */
  s: number[];
  color: string;
  rotY?: number;
  rotX?: number;
  rotZ?: number;
  seg?: number;
  glow?: boolean;
}

const tmpColor = new THREE.Color();

function geometryOf(part: Part): THREE.BufferGeometry {
  const seg = part.seg ?? 8;
  switch (part.kind) {
    case 'box': return new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
    case 'cyl': return new THREE.CylinderGeometry(part.s[0], part.s[2] ?? part.s[0], part.s[1], seg);
    case 'cone': return new THREE.ConeGeometry(part.s[0], part.s[1], seg);
    case 'sphere': return new THREE.IcosahedronGeometry(part.s[0], 1);
    case 'oct': return new THREE.OctahedronGeometry(part.s[0], 0);
    case 'hcyl': { const g = new THREE.CylinderGeometry(part.s[0], part.s[0], part.s[1], seg, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); return g; }
    case 'torus': return new THREE.TorusGeometry(part.s[0], part.s[1], 6, seg * 3);
    case 'ring': { const g = new THREE.RingGeometry(part.s[0], part.s[1], seg * 4); g.rotateX(-Math.PI / 2); return g; }
  }
}

/** Детали → одна геометрия с атрибутом color (без индексов, flat shading материала). */
export function mergeParts(parts: Part[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  const geos = parts.map((part) => {
    let g = geometryOf(part);
    if (g.index) g = g.toNonIndexed();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...part.p),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotX ?? 0, part.rotY ?? 0, part.rotZ ?? 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    tmpColor.set(part.color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = tmpColor.r; col[i * 3 + 1] = tmpColor.g; col[i * 3 + 2] = tmpColor.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  merged?.computeBoundingSphere();
  return merged;
}

/** Общие материалы: матовый low-poly и светящиеся элементы (окна, вывески). */
export const SOLID_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: true });
/** Неосвещаемый материал: яркость задаётся множителем цвета (0,6 — тускло, 1 — светится). */
export function glowMaterial(brightness: number) {
  return new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(brightness, brightness, brightness), toneMapped: false });
}
