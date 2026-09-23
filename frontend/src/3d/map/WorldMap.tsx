// Map mode (M): pins over the world from a bird's-eye view. "Task → selected team base" lines appear only here
// so the main world doesn't turn into a "plate of spaghetti".
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import type { WorldTask as PublicTask, WorldTeam as Team } from '../../shared/types';
import type { WorldLayout } from '../world/WorldLayout';
import type { PresenceStore } from '../multiplayer/PresenceStore';
import { relationOf, usePresence } from '../multiplayer/RemotePlayers';
import * as THREE from 'three';

interface Props {
  layout: WorldLayout;
  tasks: PublicTask[];
  teams: Team[];
  store: PresenceStore;
  myTeamId: string | null;
  respondedIds: Set<string>;
  selectedId: string | null;
  me: React.MutableRefObject<THREE.Vector3>;
  onTask: (id: string) => void;
}

export function WorldMap({ layout, tasks, teams, store, myTeamId, respondedIds, selectedId, me, onTask }: Props) {
  usePresence(store);
  const [who, setWho] = useState<string | null>(null);
  const lines = useMemo(() => tasks.flatMap((t) => t.selectedTeams.map((tm) => {
    const a = layout.byTask[t.id], b = layout.byTeam[tm.id];
    if (!a || !b) return null;
    return { key: `${t.id}:${tm.id}`, color: tm.color, points: [[a.x, 1.2, a.z], [ (a.x + b.x) / 2, 14, (a.z + b.z) / 2 ], [b.x, 1.2, b.z]] as [number, number, number][] };
  }).filter((x): x is NonNullable<typeof x> => !!x)), [tasks, layout]);

  const others = [...store.players.values()].filter((s) => s.presence.userId !== store.me);

  return (
    <group>
      <Html position={[0, 22, 0]} center zIndexRange={[40, 0]}><div className="map-pin plaza">🏆 Triumph Plaza</div></Html>
      {tasks.map((t) => {
        const p = layout.byTask[t.id];
        if (!p) return null;
        const mine = respondedIds.has(t.id);
        return (
          <Html key={t.id} position={[p.x, 3, p.z]} center zIndexRange={[38, 0]}>
            <button className={`map-pin task lvl-${t.score.levelKey} ${selectedId === t.id ? 'sel' : ''} ${mine ? 'mine' : ''}`} onClick={() => onTask(t.id)} title={t.title}>
              <b>{t.score.total}</b>{p.featured && <i>★</i>}{mine && <em>✓</em>}
            </button>
          </Html>
        );
      })}
      {teams.map((tm) => {
        const s = layout.byTeam[tm.id];
        if (!s) return null;
        return (
          <Html key={tm.id} position={[s.x, 3, s.z]} center zIndexRange={[39, 0]}>
            <div className={`map-pin base ${tm.id === myTeamId ? 'mine' : ''}`} style={{ borderColor: tm.color }}><i style={{ background: tm.color }} />⚑ {tm.name}</div>
          </Html>
        );
      })}
      {lines.map((l) => <Line key={l.key} points={l.points} color={l.color} lineWidth={3} dashed dashSize={2} gapSize={1.2} />)}
      {others.map((s) => {
        const rel = relationOf(s.presence, myTeamId);
        return <MapPlayer key={s.presence.userId} store={store} id={s.presence.userId} rel={rel} color={s.presence.teamColor} name={s.presence.displayName} team={s.presence.teamName} open={who === s.presence.userId} onClick={() => setWho(who === s.presence.userId ? null : s.presence.userId)} />;
      })}
      <MapMe me={me} />
    </group>
  );
}

function MapPlayer({ store, id, rel, color, name, team, open, onClick }: { store: PresenceStore; id: string; rel: string; color: string; name: string; team: string | null; open: boolean; onClick: () => void }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    const st = store.players.get(id);
    if (st && g.current) g.current.position.set(st.presence.position[0], 2, st.presence.position[2]);
  });
  return (
    <group ref={g}>
      <Html center zIndexRange={[41, 0]}>
        <button className={`map-pin player ${rel}`} style={{ background: color }} onClick={onClick} title={name}>
          {rel === 'teammate' ? '★' : ''}
          {open && <span className="map-who"><b>{name}</b>{team ? ` · ${team}` : ''}</span>}
        </button>
      </Html>
    </group>
  );
}

function MapMe({ me }: { me: React.MutableRefObject<THREE.Vector3> }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => { g.current?.position.set(me.current.x, 2.2, me.current.z); });
  return <group ref={g}><Html center zIndexRange={[42, 0]}><div className="map-pin me">You</div></Html></group>;
}
