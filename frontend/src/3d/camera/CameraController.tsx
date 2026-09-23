// Camera: elevated third person (as in casual exploration), top-down map (M), a short fly-over on first entry.
// Mouse drag rotates the camera (pans in the map), the wheel zooms. A click after a drag doesn't count as a click.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export type CameraMode = 'intro' | 'explore' | 'map';

export interface CameraState {
  yaw: number;
  pitch: number;
  dist: number;
  map: { x: number; z: number; zoom: number };
  /** map "focus" target (e.g. "My team") — the camera smoothly flies to it */
  mapTarget: { x: number; z: number; zoom: number } | null;
}

export function useCameraState(): React.MutableRefObject<CameraState> {
  return useRef<CameraState>({ yaw: 0, pitch: 0.5, dist: 13, map: { x: 0, z: 0, zoom: 1 }, mapTarget: null });
}

interface Props {
  mode: CameraMode;
  state: React.MutableRefObject<CameraState>;
  player: React.MutableRefObject<THREE.Vector3>;
  dragRef: React.MutableRefObject<{ moved: boolean }>;
  reduced: boolean;
  onIntroEnd: () => void;
  /** fly-over points: plaza, tasks, team bases */
  tour: { teamsZ: number; businessZ: number };
  focus: React.MutableRefObject<THREE.Vector3>;
}

export function CameraController({ mode, state, player, dragRef, reduced, onIntroEnd, tour, focus }: Props) {
  const { camera, gl } = useThree();
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const introStart = useRef<number | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // fly-over: from above → Triumph Plaza → business district → team bases → behind the character
  const intro = useMemo(() => ({
    pos: new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 140, 190), new THREE.Vector3(46, 52, 48), new THREE.Vector3(-30, 44, -tour.businessZ + 30),
      new THREE.Vector3(-40, 36, tour.teamsZ + 26), new THREE.Vector3(0, 12, tour.teamsZ + 16),
    ]),
    look: new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 9, 0), new THREE.Vector3(0, 4, -tour.businessZ),
      new THREE.Vector3(0, 2, tour.teamsZ), new THREE.Vector3(0, 2, tour.teamsZ),
    ]),
  }), [tour.businessZ, tour.teamsZ]);

  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number; btn: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, btn: e.button }; dragRef.current.moved = false; };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!dragRef.current.moved && Math.hypot(dx, dy) < 5) return;
      dragRef.current.moved = true;
      const s = state.current;
      if (modeRef.current === 'map') {
        const k = 0.28 * s.map.zoom;
        s.mapTarget = null;
        s.map.x -= e.movementX * k; s.map.z -= e.movementY * k;
        s.map.x = THREE.MathUtils.clamp(s.map.x, -120, 120); s.map.z = THREE.MathUtils.clamp(s.map.z, -120, 120);
      } else if (modeRef.current === 'explore') {
        s.yaw -= e.movementX * 0.006;
        s.pitch = THREE.MathUtils.clamp(s.pitch + e.movementY * 0.004, 0.12, 1.25);
      }
    };
    const onUp = () => { down = null; setTimeout(() => { dragRef.current.moved = false; }, 0); };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = state.current;
      if (modeRef.current === 'map') { s.mapTarget = null; s.map.zoom = THREE.MathUtils.clamp(s.map.zoom * (1 + Math.sign(e.deltaY) * 0.1), 0.3, 1.35); }
      else s.dist = THREE.MathUtils.clamp(s.dist * (1 + Math.sign(e.deltaY) * 0.08), 6, 30);
    };
    const onContext = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
    };
  }, [gl, state, dragRef]);

  useEffect(() => { if (mode === 'intro') introStart.current = null; }, [mode]);

  const desired = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((clock, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = state.current;
    const p = player.current;
    if (modeRef.current === 'intro') {
      if (reduced) { onIntroEnd(); return; }
      if (introStart.current === null) introStart.current = clock.clock.elapsedTime;
      const t = Math.min(1, (clock.clock.elapsedTime - introStart.current) / 6.5);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      // the last fly-over point is behind the character
      intro.pos.points[4].set(p.x + Math.sin(s.yaw) * s.dist * Math.cos(s.pitch), 1.6 + Math.sin(s.pitch) * s.dist, p.z + Math.cos(s.yaw) * s.dist * Math.cos(s.pitch));
      intro.look.points[4].set(p.x, 1.6, p.z);
      intro.pos.getPoint(e, desired);
      intro.look.getPoint(e, lookTarget);
      camera.position.copy(desired);
      look.current.copy(lookTarget);
      camera.lookAt(look.current);
      focus.current.copy(lookTarget);
      if (t >= 1) onIntroEnd();
      return;
    }
    const k = reduced ? 1 : 1 - Math.exp(-dt * 7);
    if (modeRef.current === 'map') {
      if (s.mapTarget) {
        s.map.x += (s.mapTarget.x - s.map.x) * Math.min(1, dt * 3);
        s.map.z += (s.mapTarget.z - s.map.z) * Math.min(1, dt * 3);
        s.map.zoom += (s.mapTarget.zoom - s.map.zoom) * Math.min(1, dt * 3);
      }
      const H = 165 * s.map.zoom;
      desired.set(s.map.x, H, s.map.z + H * 0.32);
      lookTarget.set(s.map.x, 0, s.map.z);
      focus.current.set(s.map.x, 0, s.map.z);
    } else {
      lookTarget.set(p.x, 1.6, p.z);
      desired.set(p.x + Math.sin(s.yaw) * s.dist * Math.cos(s.pitch), 1.6 + Math.sin(s.pitch) * s.dist, p.z + Math.cos(s.yaw) * s.dist * Math.cos(s.pitch));
      focus.current.copy(p);
    }
    camera.position.lerp(desired, k);
    look.current.lerp(lookTarget, k);
    camera.lookAt(look.current);
  });
  return null;
}
