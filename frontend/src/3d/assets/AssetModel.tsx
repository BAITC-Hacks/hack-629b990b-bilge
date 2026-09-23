// Загрузка ассетов из реестра: одиночная модель и массовая отрисовка (InstancedMesh, один вызов на материал).
// Любая ошибка загрузки — простая геометрия вместо модели; мир не ломается.
import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { asset } from './assetRegistry';

export class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn('3D-модель не загрузилась, используется простая геометрия', e); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
export function Safe({ fallback = null, children }: { fallback?: ReactNode; children: ReactNode }) {
  return <ModelBoundary fallback={fallback}><Suspense fallback={fallback}>{children}</Suspense></ModelBoundary>;
}

/** Геометрия модели, «запечённая» в одну систему координат: основание на y=0, центр по x/z в нуле, масштаб набора. */
interface Baked { parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[]; size: THREE.Vector3 }
const bakedCache = new Map<string, Baked>();

function bake(id: string, scene: THREE.Object3D): Baked {
  const hit = bakedCache.get(id);
  if (hit) return hit;
  const def = asset(id);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  const fix = new THREE.Matrix4().makeScale(def.scale, def.scale, def.scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const g = (m.geometry as THREE.BufferGeometry).clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(fix, m.matrixWorld));
    // оставляем только общие атрибуты, чтобы геометрии сливались
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat = mats[0];
    byMat.set(mat, [...(byMat.get(mat) ?? []), g]);
  });
  const parts: Baked['parts'] = [];
  for (const [material, geos] of byMat) {
    const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = flat.length === 1 ? flat[0] : mergeGeometries(flat, false);
    if (merged) {
      const mat = (material as THREE.MeshStandardMaterial).clone();
      mat.metalness = 0;
      mat.roughness = Math.max(0.75, mat.roughness ?? 0.9);
      parts.push({ geometry: merged, material: mat });
    }
  }
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(def.scale);
  const out = { parts, size };
  bakedCache.set(id, out);
  return out;
}

export function useBaked(id: string): Baked {
  const gltf = useGLTF(asset(id).url);
  return useMemo(() => bake(id, gltf.scene), [id, gltf.scene]);
}

/** Одна статичная модель. */
export function AssetModel({ id, position, rotationY = 0, scale = 1, castShadow }: { id: string; position?: [number, number, number]; rotationY?: number; scale?: number; castShadow?: boolean }) {
  const b = useBaked(id);
  const shadow = castShadow ?? asset(id).shadow;
  return (
    <group position={position} rotation-y={rotationY} scale={scale}>
      {b.parts.map((p, i) => <mesh key={i} geometry={p.geometry} material={p.material} castShadow={shadow} receiveShadow />)}
    </group>
  );
}

export interface Placement { x: number; z: number; r: number; s?: number; y?: number }

/** Много копий одной модели — по одному InstancedMesh на материал. */
export function InstancedAsset({ id, items, castShadow }: { id: string; items: Placement[]; castShadow?: boolean }) {
  const b = useBaked(id);
  const shadow = castShadow ?? asset(id).shadow;
  if (!items.length) return null;
  return <>{b.parts.map((p, i) => <InstancedPart key={i} geometry={p.geometry} material={p.material} items={items} shadow={shadow} />)}</>;
}

function InstancedPart({ geometry, material, items, shadow }: { geometry: THREE.BufferGeometry; material: THREE.Material; items: Placement[]; shadow: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.r);
      p.set(it.x, it.y ?? 0, it.z);
      const k = it.s ?? 1;
      s.set(k, k, k);
      m.setMatrixAt(i, mtx.compose(p, q, s));
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={shadow} receiveShadow frustumCulled />;
}

/** Группа инстансов по реестру: { assetId: placements[] }. Каждая модель грузится независимо, ошибка одной не мешает остальным. */
export function InstancedGroups({ groups }: { groups: Record<string, Placement[]> }) {
  return (
    <>
      {Object.entries(groups).map(([id, items]) => (
        <Safe key={id}><InstancedAsset id={id} items={items} /></Safe>
      ))}
    </>
  );
}

export function preloadAssets(ids: string[]) {
  ids.forEach((id) => useGLTF.preload(asset(id).url));
}
