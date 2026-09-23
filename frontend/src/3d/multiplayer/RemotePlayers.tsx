// Other online players. Position interpolates server packets (no teleports), emotes come from the server,
// random idle actions are local and purely visual.
import { memo, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerPresence } from '../../shared/types';
import { PlayerAvatar, type Clip, type Relation } from '../players/PlayerAvatar';
import { EMOTE_CLIP, IdleActions } from '../players/PlayerEmotes';
import { INTERP_DELAY_MS, SNAP_DISTANCE } from './NetworkInterpolation';
import type { PresenceStore } from './PresenceStore';

export function relationOf(p: PlayerPresence, myTeamId: string | null): Relation {
  if (p.role === 'guest') return 'guest';
  if (p.role === 'business') return 'business';
  return myTeamId && p.teamId === myTeamId ? 'teammate' : 'other';
}

export function usePresence(store: PresenceStore) {
  return useSyncExternalStore((fn) => store.subscribe(fn), () => store.version);
}

export function RemotePlayers({ store, myTeamId }: { store: PresenceStore; myTeamId: string | null }) {
  usePresence(store);
  const others = [...store.players.values()].filter((s) => s.presence.userId !== store.me);
  return <>{others.map((s) => <RemotePlayer key={s.presence.userId} store={store} id={s.presence.userId} presence={s.presence} status={s.presence.presence} relation={relationOf(s.presence, myTeamId)} />)}</>;
}

const RemotePlayer = memo(function RemotePlayer({ store, id, presence, status, relation }: { store: PresenceStore; id: string; presence: PlayerPresence; status: string; relation: Relation }) {
  const group = useRef<THREE.Group>(null);
  const pos = useRef(new THREE.Vector3(presence.position[0], 0, presence.position[2]));
  const rot = useRef(presence.rotation);
  const clip = useRef<Clip>('idle');
  const idle = useMemo(() => new IdleActions(4000 + Math.random() * 6000), []);
  const speed = useRef(0);

  useFrame((_, rawDt) => {
    const st = store.players.get(id);
    const g = group.current;
    if (!st || !g) return;
    const dt = Math.min(rawDt, 0.05);
    const now = performance.now();
    const s = st.buffer.sample(now - INTERP_DELAY_MS);
    if (s) {
      const p = pos.current;
      const dx = s.x - p.x, dz = s.z - p.z;
      const dist = Math.hypot(dx, dz);
      // normally follow the interpolated path exactly; a large drift gets a soft accelerated correction
      const k = dist > SNAP_DISTANCE ? Math.min(1, dt * 4) : dist > 2.5 ? Math.min(1, dt * 12) : 1;
      const px = p.x, pz = p.z;
      p.x += dx * k; p.z += dz * k;
      speed.current = Math.hypot(p.x - px, p.z - pz) / Math.max(dt, 1e-4);
      let d = s.r - rot.current;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      rot.current += d * Math.min(1, dt * 12);
    }
    g.position.copy(pos.current);
    g.rotation.y = rot.current;
    const m = st.presence.movementState;
    if (m !== 'idle' || speed.current > 0.6) { idle.moving(); clip.current = m === 'run' || speed.current > 5.6 ? 'sprint' : 'walk'; return; }
    if (st.action && now < st.action.until) { idle.moving(); clip.current = EMOTE_CLIP[st.action.name]; return; }
    st.action = null;
    clip.current = idle.update(now) ?? 'idle';
  });

  return (
    <group ref={group} position={[presence.position[0], 0, presence.position[2]]}>
      <PlayerAvatar
        avatarPreset={presence.avatarPreset}
        teamColor={presence.teamColor}
        teamName={presence.teamName}
        displayName={presence.displayName}
        relation={relation}
        presence={status}
        demo={presence.demo}
        clip={() => clip.current}
        worldPos={pos}
      />
    </group>
  );
});
