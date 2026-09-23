// Sky, light, fog, ground: plaza → sidewalk → road (a ring around the plaza) → sidewalk → blocks → mountain backdrop.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeParts, SOLID_MAT, type Part } from '../performance/mergeParts';
import { PLAZA, ROAD_IN, ROAD_OUT, SIDEWALK_OUT, sideToWorld, type Side, type WorldLayout } from './WorldLayout';

const ROT: Record<Side, number> = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 };

function roundedSquare(half: number, radius: number): THREE.Shape {
  const s = new THREE.Shape();
  const h = half, r = Math.min(radius, half);
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h); s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
  return s;
}
function ringShape(outer: number, rOut: number, inner: number, rIn: number): THREE.Shape {
  const s = roundedSquare(outer, rOut);
  const hole = roundedSquare(inner, rIn);
  s.holes.push(new THREE.Path(hole.getPoints(8).reverse()));
  return s;
}
/** A flat shape of thickness h (curb) lying on the ground. */
function Slab({ shape, h, y = 0, color }: { shape: THREE.Shape; h: number; y?: number; color: string }) {
  const geo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 6 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [shape, h]);
  return (
    <mesh geometry={geo} position-y={y} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.95} flatShading />
    </mesh>
  );
}

export function Sky() {
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(900, 24, 12);
    const top = new THREE.Color('#6fb6ec'), mid = new THREE.Color('#bfe0f7'), bottom = new THREE.Color('#eaf5fc');
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const k = pos.getY(i) / 900;
      if (k > 0.15) c.copy(mid).lerp(top, Math.min(1, (k - 0.15) / 0.6)); else c.copy(bottom).lerp(mid, Math.max(0, (k + 0.05) / 0.2));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  return (
    <mesh geometry={geo} renderOrder={-1}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} depthWrite={false} />
    </mesh>
  );
}

/** The sun follows the player so nearby shadows stay crisp with a small shadow map. */
export function Lights({ focus }: { focus: React.MutableRefObject<THREE.Vector3> }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const f = focus.current;
    if (!sun.current) return;
    target.position.set(f.x, 0, f.z);
    target.updateMatrixWorld();
    sun.current.position.set(f.x + 38, 70, f.z + 26);
  });
  return (
    <>
      <hemisphereLight args={['#e4f3ff', '#a7d189', 1.05]} />
      <ambientLight intensity={0.25} />
      <primitive object={target} />
      <directionalLight
        ref={sun}
        target={target}
        color="#fff3df"
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={10}
        shadow-camera-far={200}
      />
    </>
  );
}

export function Ground({ layout, triumphRef }: { layout: WorldLayout; triumphRef: React.MutableRefObject<number> }) {
  const plazaShape = useMemo(() => roundedSquare(PLAZA, 5), []);
  const innerWalk = useMemo(() => ringShape(ROAD_IN, 6, PLAZA - 0.01, 5), []);
  const road = useMemo(() => ringShape(ROAD_OUT, 12, ROAD_IN - 0.01, 6), []);
  const outerWalk = useMemo(() => ringShape(SIDEWALK_OUT, 14, ROAD_OUT - 0.01, 12), []);

  // road markings, crosswalks, block paths — one geometry
  const marks = useMemo(() => {
    const parts: Part[] = [];
    const mid = (ROAD_IN + ROAD_OUT) / 2;
    for (const side of ['N', 'E', 'S', 'W'] as Side[]) {
      for (let t = -30; t <= 30; t += 4.2) {
        if (Math.abs(t) < 6) continue;
        const [x, z] = sideToWorld(side, t, mid);
        parts.push({ kind: 'box', p: [x, 0.045, z], s: [2, 0.02, 0.22], color: '#f4f4f0', rotY: ROT[side] });
      }
      for (let k = -3; k <= 3; k++) {
        const [x, z] = sideToWorld(side, k * 1.05, mid);
        parts.push({ kind: 'box', p: [x, 0.05, z], s: [0.62, 0.02, ROAD_OUT - ROAD_IN - 0.6], color: '#fbfbf6', rotY: ROT[side] });
      }
    }
    for (const pa of layout.paths) {
      const color = pa.kind === 'plot' ? '#e6dccb' : pa.kind === 'square' ? '#eadfcb' : '#e9ddc7';
      parts.push({ kind: 'box', p: [pa.x, 0.05, pa.z], s: [pa.w, 0.1, pa.d], color, rotY: pa.rot });
    }
    // plaza pattern: rings and rays toward the monument
    for (const [r0, r1, c] of [[7.6, 8.4, '#e2cfb2'], [12.2, 12.8, '#e6d6bd'], [21.8, 22.6, '#e2cfb2']] as [number, number, string][]) {
      parts.push({ kind: 'ring', p: [0, 0.2, 0], s: [r0, r1], color: c, seg: 12 });
    }
    return mergeParts(parts);
  }, [layout.paths]);

  const strips = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state) => {
    if (!strips.current) return;
    const t = triumphRef.current;
    const base = 0.55 + Math.sin(state.clock.elapsedTime * 0.8) * 0.05;
    strips.current.color.setScalar(t >= 0 ? 1.6 : base);
  });
  const stripGeo = useMemo(() => mergeParts((['N', 'E', 'S', 'W'] as Side[]).flatMap((side) =>
    [-2.2, 2.2].map((t) => { const [x, z] = sideToWorld(side, t, 18.5); return { kind: 'box' as const, p: [x, 0.2, z] as [number, number, number], s: [0.18, 0.02, 21], color: '#7cf2e4', rotY: ROT[side] }; }))), []);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02} receiveShadow>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial color="#8cc866" roughness={1} />
      </mesh>
      <Slab shape={road} h={0.04} color="#4b5059" />
      <Slab shape={innerWalk} h={0.16} color="#d6dadf" />
      <Slab shape={outerWalk} h={0.16} color="#d6dadf" />
      <Slab shape={plazaShape} h={0.18} color="#efe4d1" />
      {marks && <mesh geometry={marks} material={SOLID_MAT} receiveShadow />}
      {stripGeo && <mesh geometry={stripGeo}><meshBasicMaterial ref={strips} vertexColors toneMapped={false} /></mesh>}
      <Pond />
    </group>
  );
}

function Pond() {
  const [x, z] = sideToWorld('W', 0, 64);
  const water = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((s) => { if (water.current) water.current.color.setHSL(0.55, 0.62, 0.58 + Math.sin(s.clock.elapsedTime * 0.7) * 0.02); });
  return (
    <group position={[x, 0, z]}>
      <mesh position-y={0.06} receiveShadow><cylinderGeometry args={[5.6, 5.9, 0.14, 20]} /><meshStandardMaterial color="#d9cdb5" flatShading /></mesh>
      <mesh position-y={0.12}><cylinderGeometry args={[4.9, 4.9, 0.06, 20]} /><meshStandardMaterial ref={water} color="#5fb4e0" roughness={0.3} /></mesh>
      <mesh position={[0, 0.22, 3.6]}><boxGeometry args={[1.6, 0.12, 3]} /><meshStandardMaterial color="#b98a5b" flatShading /></mesh>
    </group>
  );
}

/** Mountains and hills on the horizon — the backdrop (as in the campus reference). */
export function Backdrop() {
  const geo = useMemo(() => {
    const parts: Part[] = [];
    let seed = 7;
    const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + r() * 0.2;
      const dist = 250 + r() * 60;
      const h = 45 + r() * 70;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      parts.push({ kind: 'cone', p: [x, h / 2 - 2, z], s: [h * 0.75, h], color: r() < 0.5 ? '#9fb9a4' : '#a9bcc9', seg: 5, rotY: r() * 3 });
      if (h > 85) parts.push({ kind: 'cone', p: [x, h - 9, z], s: [h * 0.75 * (18 / h) * 1.1, 18.5], color: '#f4f8fb', seg: 5 });
    }
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + r() * 0.3;
      const dist = 170 + r() * 30;
      const h = 12 + r() * 14;
      parts.push({ kind: 'sphere', p: [Math.cos(a) * dist, -h * 0.35, Math.sin(a) * dist], s: [h * 1.4], color: '#86b877' });
    }
    return mergeParts(parts);
  }, []);
  return geo ? <mesh geometry={geo} material={SOLID_MAT} /> : null;
}

export function Clouds({ reduced }: { reduced: boolean }) {
  const g = useRef<THREE.Group>(null);
  const clouds = useMemo(() => Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    return { x: Math.cos(a) * (70 + (i % 3) * 30), z: Math.sin(a) * (70 + (i % 2) * 40), y: 58 + (i % 4) * 7, s: 1 + (i % 3) * 0.4 };
  }), []);
  useFrame((_, dt) => { if (g.current && !reduced) g.current.rotation.y += dt * 0.004; });
  return (
    <group ref={g}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]} scale={c.s}>
          {[[0, 0, 0, 4], [3.6, -0.6, 0.5, 3], [-3.4, -0.8, -0.4, 3.2], [1, 1.2, -1, 2.8]].map(([x, y, z, r], k) => (
            <mesh key={k} position={[x, y, z]}><icosahedronGeometry args={[r, 1]} /><meshStandardMaterial color="#ffffff" roughness={1} flatShading fog={false} /></mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
