// GRAND TRIUMPH: triggered only by the server's world.triumph event (the business confirmed the result).
// ~9 s sequence: building highlight and beacon (in TaskBuilding) → the monument lights up (Monument) →
// a light wave across the world → confetti and "fireworks" over the plaza, the building and the team base → announcement (HUD).
// Moderate particle count (≈ 520 instances); with reduced motion — only the announcement and highlight.
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldEventManager } from './WorldEventManager';
import type { WorldLayout } from '../world/WorldLayout';

const CONFETTI = 360;
const SPARKS = 160;
const COLORS = ['#f59e0b', '#14b8a6', '#7b3fe4', '#ef476f', '#2d8fbf', '#ffd166', '#ffffff'];

export function TriumphEvent({ events, layout, reduced }: { events: WorldEventManager; layout: WorldLayout; reduced: boolean }) {
  const triumph = useSyncExternalStore((fn) => events.subscribe(fn), () => events.triumph);
  if (!triumph) return null;
  const b = layout.byTask[triumph.taskId];
  const base = layout.byTeam[triumph.teamId];
  return (
    <group>
      <Html position={[0, 27, 0]} center zIndexRange={[45, 0]} style={{ pointerEvents: 'none' }}>
        <div className="triumph-sky">
          <div className="ts-kicker">GRAND TRIUMPH</div>
          <div className="ts-main">Team “{triumph.teamName}”</div>
          <div className="ts-sub">completed the task “{triumph.taskTitle}”</div>
        </div>
      </Html>
      {!reduced && <Wave events={events} />}
      {!reduced && <Particles key={triumph.start} events={events} spots={[[0, 0], b ? [b.x, b.z] : [0, 0], base ? [base.x, base.z] : [0, 0]]} />}
      {base && <TeamGlow x={base.x} z={base.z} color={triumph.teamColor} events={events} />}
    </group>
  );
}

function Wave({ events }: { events: WorldEventManager }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const t = events.triumphProgress();
    if (!ref.current || !mat.current) return;
    // the wave travels from the monument to the world edge between seconds 2 and 4
    const k = THREE.MathUtils.clamp((t * 9 - 1.8) / 2.2, 0, 1);
    const r = 2 + k * 120;
    ref.current.scale.set(r, r, 1);
    mat.current.opacity = k > 0 && k < 1 ? (1 - k) * 0.55 : 0;
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position-y={0.35}>
      <ringGeometry args={[0.93, 1, 96]} />
      <meshBasicMaterial ref={mat} color="#aef7ee" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

function Particles({ events, spots }: { events: WorldEventManager; spots: [number, number][] }) {
  const conf = useRef<THREE.InstancedMesh>(null);
  const sparks = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const confetti = useMemo(() => Array.from({ length: CONFETTI }, (_, i) => {
    const s = spots[i % 3];
    return { x: s[0] + (Math.random() - 0.5) * (i % 3 === 0 ? 34 : 14), z: s[1] + (Math.random() - 0.5) * (i % 3 === 0 ? 34 : 14), y0: 16 + Math.random() * 18, vy: 2 + Math.random() * 2.2, spin: Math.random() * 6, delay: Math.random() * 0.25, sway: Math.random() * 6 };
  }), [spots]);
  const bursts = useMemo(() => Array.from({ length: SPARKS }, (_, i) => {
    const burst = i % 4;
    const center = burst === 3 ? [spots[1][0], 16, spots[1][1]] : [(burst - 1) * 14, 30 + burst * 3, -6 + burst * 4];
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 4);
    return { c: center as [number, number, number], d: dir, at: 0.28 + burst * 0.1 };
  }), [spots]);
  const colorsReady = useRef(false);

  useFrame(() => {
    const t = events.triumphProgress();
    if (t < 0) return;
    const sec = t * 9;
    if (!colorsReady.current && conf.current && sparks.current) {
      const c = new THREE.Color();
      for (let i = 0; i < CONFETTI; i++) conf.current.setColorAt(i, c.set(COLORS[i % COLORS.length]));
      for (let i = 0; i < SPARKS; i++) sparks.current.setColorAt(i, c.set(COLORS[(i * 3) % COLORS.length]));
      conf.current.instanceColor!.needsUpdate = true;
      sparks.current.instanceColor!.needsUpdate = true;
      colorsReady.current = true;
    }
    if (conf.current) {
      confetti.forEach((p, i) => {
        const tt = Math.max(0, sec - 2.2 - p.delay * 4);
        const y = tt <= 0 ? -50 : p.y0 - tt * p.vy;
        v.set(p.x + Math.sin(tt * 2 + p.sway) * 0.8, Math.max(y, 0.3), p.z);
        e.set(tt * p.spin, tt * p.spin * 0.7, 0);
        m.compose(v, q.setFromEuler(e), one);
        conf.current!.setMatrixAt(i, m);
      });
      conf.current.instanceMatrix.needsUpdate = true;
    }
    if (sparks.current) {
      bursts.forEach((b, i) => {
        const tt = sec - b.at * 9;
        const s = tt > 0 && tt < 2.2 ? 1 - tt / 2.2 : 0;
        v.set(b.c[0] + b.d.x * Math.min(tt, 1.2), b.c[1] + b.d.y * Math.min(tt, 1.2) - Math.max(0, tt - 0.4) * 1.6, b.c[2] + b.d.z * Math.min(tt, 1.2));
        m.compose(v, q.identity(), new THREE.Vector3(s, s, s));
        sparks.current!.setMatrixAt(i, m);
      });
      sparks.current.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <>
      <instancedMesh ref={conf} args={[undefined, undefined, CONFETTI]} frustumCulled={false}>
        <boxGeometry args={[0.32, 0.03, 0.2]} />
        <meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={sparks} args={[undefined, undefined, SPARKS]} frustumCulled={false}>
        <octahedronGeometry args={[0.32, 0]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  );
}

function TeamGlow({ x, z, color, events }: { x: number; z: number; color: string; events: WorldEventManager }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (!ref.current) return;
    const t = events.triumphProgress();
    ref.current.visible = t >= 0.35;
    ref.current.scale.y = 0.6 + Math.sin(s.clock.elapsedTime * 3) * 0.1;
  });
  return (
    <mesh ref={ref} position={[x, 9, z]}>
      <cylinderGeometry args={[1.2, 3.4, 18, 20, 1, true]} />
      <meshBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}
