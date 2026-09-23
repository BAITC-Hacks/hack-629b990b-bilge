// Helpers inside the Canvas that write straight to the DOM (no React re-render every frame):
// the "TEAMMATE 42 m →" arrow, ?debug3d=1 metrics, plot and collider visualization.
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PresenceStore } from '../multiplayer/PresenceStore';
import type { WorldEventManager } from '../events/WorldEventManager';
import { AMBIENT_LABEL } from '../events/WorldEventManager';
import { DISTRICT_LABEL, districtAt, type WorldLayout } from '../world/WorldLayout';
import type { MultiplayerManager } from '../multiplayer/MultiplayerManager';

/** If the nearest teammate is farther than 30 m — an arrow at the screen edge pointing their way. */
export function TeammateCompass({ store, myTeamId, me, el }: { store: PresenceStore; myTeamId: string | null; me: React.MutableRefObject<THREE.Vector3>; el: React.RefObject<HTMLDivElement | null> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  const frame = useRef(0);
  useFrame(() => {
    if (++frame.current % 4 !== 0 || !el.current) return;
    const box = el.current;
    if (!myTeamId) { box.style.display = 'none'; return; }
    let best: { name: string; x: number; z: number; d: number } | null = null;
    for (const st of store.players.values()) {
      const p = st.presence;
      if (p.userId === store.me || p.teamId !== myTeamId) continue;
      const d = Math.hypot(p.position[0] - me.current.x, p.position[2] - me.current.z);
      if (!best || d < best.d) best = { name: p.displayName, x: p.position[0], z: p.position[2], d };
    }
    if (!best || best.d < 30) { box.style.display = 'none'; return; }
    v.set(best.x, 1.5, best.z).project(camera);
    const behind = v.z > 1;
    let sx = v.x, sy = v.y;
    if (behind) { sx = -sx; sy = -sy; }
    const onScreen = !behind && Math.abs(sx) < 0.9 && Math.abs(sy) < 0.85;
    const ang = Math.atan2(-sy, sx);
    const k = onScreen ? 1 : 0.86 / Math.max(Math.abs(sx), Math.abs(sy), 1e-3);
    const px = (Math.max(-0.9, Math.min(0.9, sx * (onScreen ? 1 : k))) * 0.5 + 0.5) * size.width;
    const py = (Math.max(-0.85, Math.min(0.85, -sy * (onScreen ? 1 : k))) * 0.5 + 0.5) * size.height;
    box.style.display = 'flex';
    box.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    box.querySelector('span')!.textContent = `${best.name} · ${Math.round(best.d)} m`;
    (box.querySelector('i') as HTMLElement).style.transform = `rotate(${ang}rad)`;
  });
  return null;
}

export function DebugProbe({ el, store, events, net, me, selected }: { el: React.RefObject<HTMLPreElement | null>; store: PresenceStore; events: WorldEventManager; net: React.MutableRefObject<MultiplayerManager | null>; me: React.MutableRefObject<THREE.Vector3>; selected: string | null }) {
  const { gl } = useThree();
  const acc = useRef({ frames: 0, t: performance.now(), fps: 0 });
  useFrame(() => {
    const a = acc.current;
    a.frames++;
    const now = performance.now();
    if (now - a.t < 500) return;
    a.fps = Math.round((a.frames * 1000) / (now - a.t));
    a.frames = 0; a.t = now;
    if (!el.current) return;
    const info = gl.info.render;
    const p = me.current;
    el.current.textContent = [
      `FPS ${a.fps}`,
      `draw calls ${info.calls} · triangles ${info.triangles.toLocaleString('en')}`,
      `online ${store.players.size} · connected ${store.connected}`,
      `net: send ${net.current?.sentPerSec ?? 0}/s · recv ${store.ticksPerSec}/s (tick ${store.netHz} Hz)`,
      `pos ${p.x.toFixed(1)}, ${p.z.toFixed(1)} · ${DISTRICT_LABEL[districtAt(p.x, p.z)]}`,
      `selected ${selected ?? '—'}`,
      `events: ${events.ambient.map((e) => AMBIENT_LABEL[e.kind]).join(', ') || '—'}${events.triumph ? ' · TRIUMPH' : ''}`,
      `pixel ratio ${gl.getPixelRatio().toFixed(2)}`,
    ].join('\n');
  });
  return null;
}

/** Plots (occupied — teal, free — gray, reserve — amber) and colliders. */
export function DebugOverlay({ layout }: { layout: WorldLayout }) {
  const used = new Set(layout.placements.map((p) => p.plot.id));
  return (
    <group position-y={0.4}>
      {layout.plots.map((p) => (
        <mesh key={p.id} position={[p.x, 0, p.z]} rotation={[-Math.PI / 2, 0, p.rot]}>
          <planeGeometry args={[p.w, p.d]} />
          <meshBasicMaterial color={used.has(p.id) ? '#14b8a6' : p.kind === 'reserve' ? '#f59e0b' : '#9aa3b2'} transparent opacity={0.28} depthWrite={false} />
        </mesh>
      ))}
      {layout.colliders.map((c, i) => c.kind === 'circle' ? (
        <mesh key={i} position={[c.x, 0.05, c.z]} rotation-x={-Math.PI / 2}><ringGeometry args={[Math.max(0, c.r - 0.08), c.r, 20]} /><meshBasicMaterial color="#ef476f" /></mesh>
      ) : (
        <lineSegments key={i} position={[c.x, 0.05, c.z]} rotation-y={c.rot}>
          <edgesGeometry args={[new THREE.BoxGeometry(c.hw * 2, 0.01, c.hd * 2)]} />
          <lineBasicMaterial color="#ef476f" />
        </lineSegments>
      ))}
    </group>
  );
}
