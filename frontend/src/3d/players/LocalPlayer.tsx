// Own character: WASD/arrows (normalized diagonal, acceleration/braking, smooth turning),
// Shift — a bit faster, E — open the nearest task, 1–4 — emotes. No physics: simple colliders and a boundary.
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Emote, MovementState } from '../../shared/types';
import { EMOTE_MS, RUN_SPEED, WALK_SPEED } from '../../shared/world';
import { resolveCollisions, type Collider } from '../world/WorldLayout';
import { PlayerAvatar, type Clip, type Relation } from './PlayerAvatar';
import { EMOTE_CLIP, EMOTE_KEYS, IdleActions } from './PlayerEmotes';

const MOVE_KEYS: Record<string, 'f' | 'b' | 'l' | 'r' | 'run'> = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', ShiftLeft: 'run', ShiftRight: 'run',
};
export function typingTarget(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable);
}

export interface PlayerRefs {
  pos: React.MutableRefObject<THREE.Vector3>;
  rot: React.MutableRefObject<number>;
  movement: React.MutableRefObject<MovementState>;
}

interface Props {
  refs: PlayerRefs;
  start: [number, number];
  colliders: Collider[];
  limit: number;
  getYaw: () => number;
  benches: { x: number; z: number }[];
  enabled: boolean;
  avatarPreset: string;
  teamColor: string;
  teamName: string | null;
  displayName: string;
  relation: Relation;
  onInteract: () => void;
  onEmote: (e: Emote) => void;
  onAnyInput: () => void;
}

export function LocalPlayer({ refs, start, colliders, limit, getYaw, benches, enabled, avatarPreset, teamColor, teamName, displayName, relation, onInteract, onEmote, onAnyInput }: Props) {
  const group = useRef<THREE.Group>(null);
  const keys = useRef({ f: false, b: false, l: false, r: false, run: false });
  const vel = useRef(new THREE.Vector2());
  const emote = useRef<{ clip: Clip; until: number } | null>(null);
  const idle = useRef(new IdleActions());
  const clipRef = useRef<Clip>('idle');
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const cb = useRef({ onInteract, onEmote, onAnyInput });
  cb.current = { onInteract, onEmote, onAnyInput };

  useEffect(() => {
    refs.pos.current.set(start[0], 0, start[1]);
    refs.rot.current = Math.atan2(-start[0], -start[1]); // facing the center
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typingTarget(e.target)) return;
      cb.current.onAnyInput();
      if (!enabledRef.current) return;
      const k = MOVE_KEYS[e.code];
      if (k) { keys.current[k] = true; if (e.code.startsWith('Arrow')) e.preventDefault(); return; }
      if (e.code === 'KeyE' && !e.repeat) { cb.current.onInteract(); return; }
      const em = EMOTE_KEYS[e.code];
      if (em && !e.repeat) {
        emote.current = { clip: EMOTE_CLIP[em], until: performance.now() + EMOTE_MS[em] };
        cb.current.onEmote(em);
      }
    };
    const up = (e: KeyboardEvent) => { const k = MOVE_KEYS[e.code]; if (k) keys.current[k] = false; };
    const blur = () => { keys.current = { f: false, b: false, l: false, r: false, run: false }; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  useFrame((_, rawDt) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    const k = keys.current;
    const ix = enabledRef.current ? Number(k.r) - Number(k.l) : 0;
    const iz = enabledRef.current ? Number(k.f) - Number(k.b) : 0;
    // direction relative to the camera; the diagonal is normalized
    const yaw = getYaw();
    let dx = 0, dz = 0;
    if (ix || iz) {
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // "forward" from the camera
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      dx = fx * iz + rx * ix; dz = fz * iz + rz * ix;
      const len = Math.hypot(dx, dz); dx /= len; dz /= len;
    }
    const speed = k.run ? RUN_SPEED : WALK_SPEED;
    const tx = dx * speed, tz = dz * speed;
    const v = vel.current;
    const accel = ix || iz ? 16 : 22; // acceleration / braking, m/s²
    const ddx = tx - v.x, ddz = tz - v.y;
    const dl = Math.hypot(ddx, ddz);
    const step = accel * dt;
    if (dl <= step) v.set(tx, tz); else v.set(v.x + (ddx / dl) * step, v.y + (ddz / dl) * step);

    const p = refs.pos.current;
    const [nx, nz] = resolveCollisions(p.x + v.x * dt, p.z + v.y * dt, colliders, 0.45, limit);
    // actual speed after collisions (for animation)
    const realSpeed = Math.hypot(nx - p.x, nz - p.z) / Math.max(dt, 1e-4);
    p.set(nx, 0, nz);
    if (Math.hypot(v.x, v.y) > 0.3) {
      const target = Math.atan2(v.x, v.y);
      let d = target - refs.rot.current;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      refs.rot.current += d * Math.min(1, dt * 11);
    }
    const moving = realSpeed > 0.4 && (ix !== 0 || iz !== 0 || Math.hypot(v.x, v.y) > 0.5);
    refs.movement.current = !moving ? 'idle' : realSpeed > WALK_SPEED * 1.15 ? 'run' : 'walk';
    g.position.copy(p);
    g.rotation.y = refs.rot.current;

    // animation: movement > emote > random idle action
    const now = performance.now();
    if (moving) { idle.current.moving(); emote.current = null; clipRef.current = refs.movement.current === 'run' ? 'sprint' : 'walk'; return; }
    if (emote.current && now < emote.current.until) { clipRef.current = emote.current.clip; idle.current.moving(); return; }
    emote.current = null;
    const nearBench = benches.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < 1.3);
    clipRef.current = idle.current.update(now, nearBench) ?? 'idle';
  });

  return (
    <group ref={group}>
      <PlayerAvatar avatarPreset={avatarPreset} teamColor={teamColor} teamName={teamName} displayName={displayName} relation={relation} clip={() => clipRef.current} worldPos={refs.pos} />
    </group>
  );
}
