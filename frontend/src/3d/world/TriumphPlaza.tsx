// TRIUMPH PLAZA — the world's main landmark: the AI Sana triumphal arch with a symbol above it, a stepped podium,
// flags, fountains, green islands, sculptures and the "Hall of Achievements". During GRAND TRIUMPH the monument lights up.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Achievement } from '../../shared/types';
import { mergeParts, SOLID_MAT, type Part } from '../performance/mergeParts';
import { FOUNTAINS, FOUNTAIN_R, HALL_POS, type WorldLayout } from './WorldLayout';
import type { WorldEventManager } from '../events/WorldEventManager';

function textTexture(text: string, color = '#16324f', bg = '#ffffff', w = 1024, h = 192) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = color;
  g.font = `900 ${Math.floor(h * 0.62)}px Inter, Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function Monument({ events, reduced }: { events: WorldEventManager; reduced: boolean }) {
  const symbol = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const label = useMemo(() => textTexture('AI SANA'), []);

  const stone = useMemo(() => {
    const p: Part[] = [];
    // podium: three steps
    p.push({ kind: 'cyl', p: [0, 0.3, 0], s: [8.2, 0.24, 8.4], color: '#f2ede4', seg: 24 });
    p.push({ kind: 'cyl', p: [0, 0.54, 0], s: [7.2, 0.24, 7.4], color: '#ebe4d8', seg: 24 });
    p.push({ kind: 'cyl', p: [0, 0.78, 0], s: [6.2, 0.24, 6.4], color: '#f2ede4', seg: 24 });
    // arch pylons (taper slightly toward the top)
    for (const x of [-5.2, 5.2]) {
      p.push({ kind: 'box', p: [x, 1.9, 0], s: [3.2, 2.2, 3], color: '#e9e4db' });
      p.push({ kind: 'box', p: [x, 8.2, 0], s: [2.6, 10.6, 2.4], color: '#ffffff' });
      p.push({ kind: 'box', p: [x, 13.7, 0], s: [3, 0.5, 2.8], color: '#e9e4db' });
    }
    // crossbeam
    p.push({ kind: 'box', p: [0, 15.2, 0], s: [14.2, 2.6, 2.8], color: '#ffffff' });
    p.push({ kind: 'box', p: [0, 16.65, 0], s: [14.8, 0.3, 3.1], color: '#e3dccf' });
    // symbol pedestal
    p.push({ kind: 'cyl', p: [0, 17.2, 0], s: [1.2, 0.8, 1.6], color: '#e9e4db', seg: 8 });
    // flagpoles around the podium
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      p.push({ kind: 'cyl', p: [Math.cos(a) * 9.2, 4, Math.sin(a) * 9.2], s: [0.08, 8, 0.1], color: '#e5e7eb', seg: 6 });
    }
    return mergeParts(p);
  }, []);
  const accents = useMemo(() => {
    const p: Part[] = [];
    for (const x of [-5.2, 5.2]) for (const z of [-1.22, 1.22]) p.push({ kind: 'box', p: [x, 8.2, z], s: [0.35, 10.2, 0.05], color: '#5ee6d6' });
    p.push({ kind: 'box', p: [0, 13.9, 1.42], s: [12.4, 0.12, 0.05], color: '#5ee6d6' });
    p.push({ kind: 'box', p: [0, 13.9, -1.42], s: [12.4, 0.12, 0.05], color: '#5ee6d6' });
    return mergeParts(p);
  }, []);
  const flags = useMemo(() => [0, 1, 2, 3].map((k) => {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    return { x: Math.cos(a) * 9.2, z: Math.sin(a) * 9.2, color: ['#14b8a6', '#7b3fe4', '#f59e0b', '#2d8fbf'][k] };
  }), []);

  useFrame((state, dt) => {
    const t = events.triumphProgress();
    const active = t >= 0;
    const speed = reduced ? 0 : active ? 2.4 : 0.35;
    if (symbol.current) {
      symbol.current.rotation.y += dt * speed;
      symbol.current.position.y = 20 + (reduced ? 0 : Math.sin(state.clock.elapsedTime * 0.9) * 0.25) + (active ? Math.sin(Math.min(1, t * 3) * Math.PI / 2) * 1.2 : 0);
    }
    if (ring.current) ring.current.rotation.x = Math.PI / 2 + (reduced ? 0 : Math.sin(state.clock.elapsedTime * 0.5) * 0.12);
    const k = active ? 1.6 + Math.sin(state.clock.elapsedTime * 6) * 0.25 : 0.85;
    glow.current?.color.setScalar(k);
    if (halo.current) halo.current.opacity = active ? 0.35 + Math.sin(state.clock.elapsedTime * 4) * 0.1 : 0.08;
  });

  return (
    <group>
      {stone && <mesh geometry={stone} material={SOLID_MAT} castShadow receiveShadow />}
      {accents && <mesh geometry={accents}><meshBasicMaterial ref={glow} vertexColors toneMapped={false} /></mesh>}
      {/* lettering on both sides of the crossbeam */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, 15.2, s * 1.42]} rotation-y={s > 0 ? 0 : Math.PI}>
          <planeGeometry args={[11, 2.05]} />
          <meshBasicMaterial map={label} toneMapped={false} />
        </mesh>
      ))}
      {/* AI Sana symbol: a glowing crystal inside a ring */}
      <group ref={symbol} position={[0, 20, 0]}>
        <mesh castShadow><octahedronGeometry args={[1.7, 0]} /><meshStandardMaterial color="#5ee6d6" emissive="#14b8a6" emissiveIntensity={0.9} flatShading roughness={0.3} /></mesh>
        <mesh ref={ring}><torusGeometry args={[3, 0.22, 8, 36]} /><meshStandardMaterial color="#f5c542" emissive="#f59e0b" emissiveIntensity={0.35} metalness={0.2} roughness={0.35} /></mesh>
        <mesh><sphereGeometry args={[4.4, 16, 12]} /><meshBasicMaterial ref={halo} color="#7cf2e4" transparent opacity={0.08} depthWrite={false} /></mesh>
      </group>
      {flags.map((f, i) => <Flag key={i} position={[f.x + 0.75, 7.2, f.z]} color={f.color} size={[1.5, 1]} reduced={reduced} events={events} />)}
    </group>
  );
}

/** A flag from a segmented plane: vertices wave (cheap, no shaders). */
export function Flag({ position, color, size = [1.2, 0.8], reduced, events, strong }: { position: [number, number, number]; color: string; size?: [number, number]; reduced: boolean; events?: WorldEventManager; strong?: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(size[0], size[1], 6, 2), [size]);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array), [geo]);
  const phase = useMemo(() => Math.random() * 10, []);
  useFrame((state) => {
    if (reduced || !ref.current) return;
    const gust = strong || events?.isActive('banners') || (events?.triumphProgress() ?? -1) >= 0 ? 2.2 : 1;
    const t = state.clock.elapsedTime * 3 * (gust > 1 ? 1.6 : 1) + phase;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3] + size[0] / 2; // 0 at the pole
      pos.setZ(i, Math.sin(t + x * 2.4) * 0.12 * x * gust);
    }
    pos.needsUpdate = true;
  });
  return (
    <mesh ref={ref} geometry={geo} position={position} castShadow>
      <meshStandardMaterial color={color} side={THREE.DoubleSide} roughness={0.8} />
    </mesh>
  );
}

export function Fountains({ events, reduced }: { events: WorldEventManager; reduced: boolean }) {
  return <>{FOUNTAINS.map(([x, z], i) => <Fountain key={i} x={x} z={z} events={events} reduced={reduced} />)}</>;
}

function Fountain({ x, z, events, reduced }: { x: number; z: number; events: WorldEventManager; reduced: boolean }) {
  const drops = useRef<THREE.InstancedMesh>(null);
  const N = 48;
  const seeds = useMemo(() => Array.from({ length: N }, () => ({ a: Math.random() * Math.PI * 2, v: 0.8 + Math.random() * 0.5, o: Math.random() })), []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const water = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (water.current) water.current.color.setHSL(0.54, 0.65, 0.6 + Math.sin(t * 1.3 + x) * 0.03);
    if (!drops.current) return;
    const boost = events.isActive('fountain') || events.triumphProgress() >= 0 ? 1.7 : 1;
    seeds.forEach((s, i) => {
      const k = reduced ? 0.5 : ((t * 0.55 + s.o) % 1);
      const r = k * 1.5 * s.v;
      const h = 1.3 + (4 * k * (1 - k)) * 3.2 * s.v * boost;
      m.makeTranslation(Math.cos(s.a) * r, h, Math.sin(s.a) * r);
      drops.current!.setMatrixAt(i, m);
    });
    drops.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <group position={[x, 0.18, z]}>
      <mesh castShadow receiveShadow><cylinderGeometry args={[FOUNTAIN_R, FOUNTAIN_R + 0.2, 0.7, 20]} /><meshStandardMaterial color="#e9e3d8" flatShading /></mesh>
      <mesh position-y={0.36}><cylinderGeometry args={[FOUNTAIN_R - 0.3, FOUNTAIN_R - 0.3, 0.06, 20]} /><meshStandardMaterial ref={water} color="#69c0ea" roughness={0.25} /></mesh>
      <mesh position-y={0.9} castShadow><cylinderGeometry args={[0.35, 0.55, 1.2, 10]} /><meshStandardMaterial color="#f2ede4" flatShading /></mesh>
      <mesh position-y={1.55}><cylinderGeometry args={[1.1, 0.8, 0.18, 14]} /><meshStandardMaterial color="#e9e3d8" flatShading /></mesh>
      <instancedMesh ref={drops} args={[undefined, undefined, N]}>
        <icosahedronGeometry args={[0.09, 0]} />
        <meshStandardMaterial color="#bfe9ff" emissive="#7fd3ff" emissiveIntensity={0.4} />
      </instancedMesh>
    </group>
  );
}

/** Green islands, flower beds, bins: all as instances/a single geometry. */
export function PlazaGreens({ layout }: { layout: WorldLayout }) {
  const geo = useMemo(() => {
    const p: Part[] = [];
    for (const pl of layout.planters) {
      p.push({ kind: 'box', p: [pl.x, 0.45, pl.z], s: [pl.w, 0.7, pl.d], color: '#e3dccf', rotY: pl.rot });
      p.push({ kind: 'box', p: [pl.x, 0.82, pl.z], s: [pl.w - 0.3, 0.06, pl.d - 0.3], color: '#6fb552', rotY: pl.rot });
      if (pl.tree) {
        p.push({ kind: 'cyl', p: [pl.x, 1.9, pl.z], s: [0.14, 2.2, 0.2], color: '#8a5a3c', seg: 6 });
        p.push({ kind: 'sphere', p: [pl.x, 3.5, pl.z], s: [pl.w > 5 ? 2.1 : 1.5], color: '#5aa64a' });
        p.push({ kind: 'sphere', p: [pl.x + 0.6, 3, pl.z + 0.4], s: [pl.w > 5 ? 1.3 : 0.95], color: '#6dbb55' });
      }
      const n = Math.max(2, Math.round(pl.w / 1.3));
      for (let i = 0; i < n; i++) {
        const lx = -pl.w / 2 + 0.6 + (i * (pl.w - 1.2)) / Math.max(1, n - 1);
        const cx = pl.x + Math.cos(pl.rot) * lx, cz = pl.z - Math.sin(pl.rot) * lx;
        p.push({ kind: 'sphere', p: [cx, 1.05, cz], s: [0.35], color: i % 2 ? '#f28ab2' : '#ffd166' });
      }
    }
    for (const f of layout.flowerBeds) {
      p.push({ kind: 'cyl', p: [f.x, 0.18, f.z], s: [f.r, 0.3, f.r + 0.08], color: '#d8cfbf', seg: 10 });
      p.push({ kind: 'cyl', p: [f.x, 0.34, f.z], s: [f.r - 0.12, 0.05, f.r - 0.12], color: '#5b9e45', seg: 10 });
      const k = Math.max(3, Math.round(f.r * 5));
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2 + f.x;
        const rr = (f.r - 0.35) * (i % 2 ? 0.45 : 0.85);
        p.push({ kind: 'sphere', p: [f.x + Math.cos(a) * rr, 0.5, f.z + Math.sin(a) * rr], s: [0.2], color: f.color });
      }
    }
    for (const b of layout.bins) {
      p.push({ kind: 'cyl', p: [b.x, 0.5, b.z], s: [0.3, 0.9, 0.26], color: '#4f6d7a', seg: 8 });
      p.push({ kind: 'cyl', p: [b.x, 0.98, b.z], s: [0.33, 0.08, 0.33], color: '#37505b', seg: 8 });
    }
    return mergeParts(p);
  }, [layout]);
  return geo ? <mesh geometry={geo} material={SOLID_MAT} castShadow receiveShadow /> : null;
}

/** Campus-style sculptures: abstract shapes on pedestals. */
export function Sculptures() {
  const geo = useMemo(() => {
    const p: Part[] = [];
    for (const [x, z, c] of [[-11.5, -24.5, '#f59e0b'], [11.5, -24.5, '#7b61ff']] as [number, number, string][]) {
      p.push({ kind: 'box', p: [x, 0.8, z], s: [1.8, 1.3, 1.8], color: '#dcd5c8' });
      p.push({ kind: 'torus', p: [x, 3.1, z], s: [1.1, 0.32], color: c, rotY: 0.6 });
      p.push({ kind: 'sphere', p: [x + 0.4, 2.0, z], s: [0.55], color: '#ffffff' });
      p.push({ kind: 'oct', p: [x - 0.3, 4.5, z], s: [0.5], color: c });
    }
    return mergeParts(p);
  }, []);
  return geo ? <mesh geometry={geo} material={SOLID_MAT} castShadow receiveShadow /> : null;
}

/** "Hall of Achievements": the latest results confirmed by businesses. Not a leaderboard. */
export function HallOfAchievements({ items }: { items: Achievement[] }) {
  return (
    <group position={[HALL_POS.x, 0, HALL_POS.z]} rotation-y={HALL_POS.rot}>
      <mesh position={[0, 1.8, 0]} castShadow><boxGeometry args={[6.4, 3.2, 0.4]} /><meshStandardMaterial color="#16324f" flatShading /></mesh>
      <mesh position={[0, 0.2, 0]}><boxGeometry args={[6.8, 0.4, 1.1]} /><meshStandardMaterial color="#e3dccf" flatShading /></mesh>
      <Html position={[0, 1.8, 0.22]} transform distanceFactor={7.5} zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
        <div className="hall">
          <div className="hall-title">Hall of Achievements</div>
          {items.length === 0 && <div className="hall-empty">No confirmed results yet</div>}
          {items.slice(0, 4).map((a) => (
            <div key={a.id} className="hall-row">
              <i style={{ background: a.teamColor }} />
              <span><b>{a.teamName}</b> completed “{a.taskTitle.length > 38 ? a.taskTitle.slice(0, 36) + '…' : a.taskTitle}”</span>
            </div>
          ))}
        </div>
      </Html>
    </group>
  );
}
