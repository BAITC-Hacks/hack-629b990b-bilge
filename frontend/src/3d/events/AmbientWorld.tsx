// Фоновая жизнь: декоративные NPC (без значков и имён — их не спутать с игроками), машины на кольцевой дороге,
// птицы, дрон. Всё спокойное и чисто визуальное; при prefers-reduced-motion — почти неподвижно.
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { asset, NPC_CHARACTERS, ASSETS } from '../assets/assetRegistry';
import { AssetModel, Safe } from '../assets/AssetModel';
import { ROAD_IN, ROAD_OUT, type Route, type WorldLayout } from '../world/WorldLayout';
import type { WorldEventManager } from './WorldEventManager';

// ---------- путь по ломаной ----------
class PathWalker {
  pts: THREE.Vector2[];
  lens: number[] = [];
  total = 0;
  constructor(points: [number, number][], loop: boolean) {
    this.pts = points.map(([x, z]) => new THREE.Vector2(x, z));
    if (loop) this.pts.push(this.pts[0].clone());
    else this.pts = [...this.pts, ...this.pts.slice(0, -1).reverse()]; // туда и обратно
    for (let i = 1; i < this.pts.length; i++) { const l = this.pts[i].distanceTo(this.pts[i - 1]); this.lens.push(l); this.total += l; }
  }
  at(s: number, out: THREE.Vector2): number {
    let d = ((s % this.total) + this.total) % this.total;
    for (let i = 0; i < this.lens.length; i++) {
      if (d <= this.lens[i]) {
        const a = this.pts[i], b = this.pts[i + 1];
        out.copy(a).lerp(b, d / this.lens[i]);
        return Math.atan2(b.x - a.x, b.y - a.y);
      }
      d -= this.lens[i];
    }
    out.copy(this.pts[0]);
    return 0;
  }
}

// ---------- NPC ----------
function Npc({ url, route, offset, speed, events, group: inGroup, reduced }: { url: string; route: Route; offset: number; speed: number; events: WorldEventManager; group?: boolean; reduced: boolean }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => cloneSkinned(gltf.scene) as THREE.Group, [gltf.scene]);
  const scale = useMemo(() => asset(NPC_CHARACTERS[0]).scale, []);
  const root = useRef<THREE.Group>(null);
  const { actions } = useAnimations(gltf.animations, root);
  const walker = useMemo(() => new PathWalker(route.points, route.loop), [route]);
  const s = useRef(offset * walker.total);
  const pause = useRef({ until: 0, next: 4000 + Math.random() * 12000, clip: 'idle' });
  const current = useRef('');
  const tmp = useMemo(() => new THREE.Vector2(), []);
  useMemo(() => scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } }), [scene]);
  const play = (name: string) => {
    if (current.current === name) return;
    const a = actions[name];
    if (!a) return;
    a.reset().fadeIn(0.25).play();
    if (current.current) actions[current.current]?.fadeOut(0.25);
    current.current = name;
  };
  useFrame((st, dt) => {
    if (!root.current) return;
    if (inGroup && !events.isActive('npc-group')) { root.current.visible = false; return; }
    root.current.visible = true;
    const now = performance.now();
    const p = pause.current;
    if (reduced) { play('idle'); walker.at(s.current, tmp); root.current.position.set(tmp.x, 0.18, tmp.y); return; }
    if (now < p.until) { play(p.clip); return; }
    if (now > p.next && !inGroup) {
      // иногда останавливается: осмотреться, кивнуть, «проверить телефон»
      const clips = ['idle', 'emote-yes', 'emote-no', 'holding-both'];
      p.clip = clips[Math.floor(Math.random() * clips.length)];
      p.until = now + 2000 + Math.random() * 3500;
      p.next = p.until + 8000 + Math.random() * 16000;
      return;
    }
    s.current += Math.min(dt, 0.05) * speed;
    const h = walker.at(s.current, tmp);
    root.current.position.set(tmp.x, route.id === 'plaza-ring' ? 0.18 : 0.16, tmp.y);
    let d = h - root.current.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    root.current.rotation.y += d * Math.min(1, dt * 6);
    play('walk');
  });
  return <group ref={root}><primitive object={scene} scale={scale} /></group>;
}

/** Сидящий NPC на лавочке. */
function SittingNpc({ url, x, z, r }: { url: string; x: number; z: number; r: number }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => cloneSkinned(gltf.scene) as THREE.Group, [gltf.scene]);
  const root = useRef<THREE.Group>(null);
  const { actions } = useAnimations(gltf.animations, root);
  useMemo(() => scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; }), [scene]);
  useFrame(() => { const a = actions.sit; if (a && !a.isRunning()) a.reset().play(); });
  return <group ref={root} position={[x, 0.1, z]} rotation-y={r + Math.PI}><primitive object={scene} scale={asset(NPC_CHARACTERS[0]).scale} /></group>;
}

// ---------- машины ----------
function roadLoop(d: number, clockwise: boolean): Route {
  const pts: [number, number][] = [];
  const r = 7, h = d;
  for (let i = 0; i < 4; i++) {
    const cx = [1, 1, -1, -1][i] * (h - r), cz = [-1, 1, 1, -1][i] * (h - r);
    const a0 = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][i];
    for (let k = 0; k <= 5; k++) { const a = a0 + (k / 5) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  }
  return { id: 'road', points: clockwise ? pts : pts.reverse(), loop: true };
}

function Car({ id, lane, offset, speed, player, event, events }: { id: string; lane: Route; offset: number; speed: number; player: React.MutableRefObject<THREE.Vector3>; event?: boolean; events: WorldEventManager }) {
  const root = useRef<THREE.Group>(null);
  const walker = useMemo(() => new PathWalker(lane.points, true), [lane]);
  const s = useRef(offset * walker.total);
  const v = useRef(speed);
  const tmp = useMemo(() => new THREE.Vector2(), []);
  const ahead = useMemo(() => new THREE.Vector2(), []);
  useFrame((_, rawDt) => {
    if (!root.current) return;
    if (event && !events.isActive('vehicle')) { root.current.visible = false; return; }
    root.current.visible = true;
    const dt = Math.min(rawDt, 0.05);
    // притормаживает перед игроком на дороге
    walker.at(s.current + 5, ahead);
    const block = Math.hypot(ahead.x - player.current.x, ahead.y - player.current.z) < 3.2;
    v.current += ((block ? 0 : speed) - v.current) * Math.min(1, dt * 2.5);
    s.current += v.current * dt;
    const h = walker.at(s.current, tmp);
    root.current.position.set(tmp.x, 0.05, tmp.y);
    root.current.rotation.y = h;
  });
  return <group ref={root}><Safe><AssetModel id={id} /></Safe></group>;
}

// ---------- птицы и дрон ----------
function Birds({ events, reduced }: { events: WorldEventManager; reduced: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const N = 9;
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, -0.9, 0.1, -0.1, 0, 0, -0.25, 0, 0, 0.35, 0.9, 0.1, -0.1, 0, 0, -0.25], 3));
    g.computeVertexNormals();
    return g;
  }, []);
  useFrame((st) => {
    if (!ref.current) return;
    const t = st.clock.elapsedTime;
    const fly = events.isActive('birds');
    for (let i = 0; i < N; i++) {
      const a = (reduced ? 0 : t * (fly ? 0.35 : 0.12)) + i * 0.18;
      const R = fly ? 34 : 60;
      const x = Math.cos(a) * R + (i % 3) * 1.4, z = Math.sin(a) * R + Math.floor(i / 3) * 1.2;
      const y = (fly ? 24 : 38) + Math.sin(t * 2 + i) * 0.6;
      q.setFromEuler(new THREE.Euler(0, -a, 0));
      const flap = 1 + Math.sin(t * 9 + i) * 0.35;
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(flap, 1, 1));
      ref.current.setMatrixAt(i, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, undefined, N]}><meshStandardMaterial color="#4b5563" side={THREE.DoubleSide} flatShading /></instancedMesh>;
}

function Drone({ events, reduced }: { events: WorldEventManager; reduced: boolean }) {
  const root = useRef<THREE.Group>(null);
  const rotors = useRef<THREE.Group>(null);
  useFrame((st, dt) => {
    if (!root.current) return;
    const t = st.clock.elapsedTime;
    const on = events.isActive('drone');
    const a = reduced ? 0 : t * (on ? 0.45 : 0.18);
    root.current.position.set(58 + Math.cos(a) * (on ? 16 : 6), (on ? 14 : 18) + Math.sin(t * 1.3) * 0.4, Math.sin(a) * (on ? 26 : 6));
    root.current.rotation.y = -a;
    if (rotors.current && !reduced) rotors.current.rotation.y += dt * 30;
  });
  return (
    <group ref={root}>
      <mesh castShadow><boxGeometry args={[0.8, 0.22, 0.8]} /><meshStandardMaterial color="#e5e7eb" flatShading /></mesh>
      <mesh position-y={-0.16}><sphereGeometry args={[0.14, 8, 6]} /><meshBasicMaterial color="#7cf2e4" /></mesh>
      <group ref={rotors}>
        {[[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.16, z]}><boxGeometry args={[0.7, 0.02, 0.08]} /><meshStandardMaterial color="#374151" /></mesh>
        ))}
      </group>
    </group>
  );
}

export function AmbientWorld({ layout, events, reduced, player }: { layout: WorldLayout; events: WorldEventManager; reduced: boolean; player: React.MutableRefObject<THREE.Vector3> }) {
  useSyncExternalStore((fn) => events.subscribe(fn), () => events.ambient.length);
  const npcUrls = NPC_CHARACTERS.map((id) => ASSETS[id].url);
  const route = (id: string) => layout.routes.find((r) => r.id === id)!;
  const inner = useMemo(() => roadLoop(ROAD_IN + 2, true), []);
  const outer = useMemo(() => roadLoop(ROAD_OUT - 2, false), []);
  const benchSeats = layout.benches.filter((b) => Math.hypot(b.x, b.z) < 29).slice(0, 2);
  return (
    <group>
      <Safe>
        <Npc url={npcUrls[0]} route={route('plaza-ring')} offset={0} speed={1.25} events={events} reduced={reduced} />
        <Npc url={npcUrls[1]} route={route('plaza-ring')} offset={0.5} speed={1.1} events={events} reduced={reduced} />
        <Npc url={npcUrls[2]} route={route('sidewalk')} offset={0.1} speed={1.4} events={events} reduced={reduced} />
        <Npc url={npcUrls[3]} route={route('sidewalk')} offset={0.6} speed={1.2} events={events} reduced={reduced} />
        <Npc url={npcUrls[0]} route={route('lane-n')} offset={0.3} speed={1.1} events={events} reduced={reduced} />
        <Npc url={npcUrls[1]} route={route('lane-e')} offset={0.7} speed={1.2} events={events} reduced={reduced} />
        <Npc url={npcUrls[2]} route={route('south-axis')} offset={0.2} speed={1.3} events={events} reduced={reduced} />
        {benchSeats.map((b, i) => <SittingNpc key={i} url={npcUrls[(i + 3) % npcUrls.length]} x={b.x} z={b.z} r={b.r} />)}
        {/* событие: группа прохожих через Triumph Plaza */}
        {[0, 0.012, 0.024].map((o, i) => <Npc key={`g${i}`} url={npcUrls[(i + 1) % npcUrls.length]} route={route('south-axis')} offset={o} speed={1.5} events={events} group reduced={reduced} />)}
      </Safe>
      {!reduced && (
        <>
          <Car id="car-taxi" lane={inner} offset={0} speed={7.5} player={player} events={events} />
          <Car id="car-sedan" lane={inner} offset={0.5} speed={7} player={player} events={events} />
          <Car id="car-suv" lane={outer} offset={0.25} speed={8} player={player} events={events} />
          <Car id="car-garbage-truck" lane={outer} offset={0.7} speed={6} player={player} events={events} event />
        </>
      )}
      <Birds events={events} reduced={reduced} />
      <Drone events={events} reduced={reduced} />
    </group>
  );
}
