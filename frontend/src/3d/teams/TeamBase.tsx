// База команды прямо в мире: площадка цвета команды, навес, стол с ноутбуками, лавочки, флаг,
// табличка (название, подтверждённые очки, кто онлайн, над чем работает). Точка появления участников.
import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { PublicTask, Team } from '../../shared/types';
import { mergeParts, SOLID_MAT, type Part } from '../performance/mergeParts';
import { Flag } from '../world/TriumphPlaza';
import { TEAM_BASE_R, type TeamSlot } from '../world/WorldLayout';
import type { WorldEventManager } from '../events/WorldEventManager';
import { AssetModel, Safe } from '../assets/AssetModel';

interface Props {
  team: Team;
  slot: TeamSlot;
  mine: boolean;
  onlineCount: number;
  workingOn: PublicTask[];
  myResponses: number;
  reduced: boolean;
  events: WorldEventManager;
  celebrating: boolean;
  near: boolean;
}

export const TeamBase = memo(function TeamBase({ team, slot, mine, onlineCount, workingOn, myResponses, reduced, events, celebrating, near }: Props) {
  const geo = useMemo(() => {
    const p: Part[] = [];
    const c = team.color;
    p.push({ kind: 'cyl', p: [0, 0.12, 0], s: [TEAM_BASE_R, 0.24, TEAM_BASE_R + 0.15], color: '#f1ede6', seg: 28 });
    p.push({ kind: 'ring', p: [0, 0.26, 0], s: [TEAM_BASE_R - 0.45, TEAM_BASE_R - 0.05], color: c, seg: 8 });
    // навес: четыре стойки и плоская крыша цвета команды
    for (const [x, z] of [[-2.6, -2.2], [2.6, -2.2], [-2.6, 1.4], [2.6, 1.4]]) p.push({ kind: 'cyl', p: [x, 1.6, z], s: [0.08, 3.2, 0.08], color: '#e5e7eb', seg: 6 });
    p.push({ kind: 'box', p: [0, 3.25, -0.4], s: [6.2, 0.18, 4.6], color: c, rotX: -0.08 });
    p.push({ kind: 'box', p: [0, 3.1, -0.4], s: [6.4, 0.08, 4.8], color: '#ffffff', rotX: -0.08 });
    // стол и ноутбуки
    p.push({ kind: 'box', p: [0, 0.95, -0.4], s: [3.2, 0.1, 1.3], color: '#f7f7f7' });
    for (const x of [-1.2, 1.2]) p.push({ kind: 'box', p: [x, 0.5, -0.4], s: [0.1, 0.8, 1.1], color: '#9aa3b2' });
    for (const x of [-0.9, 0.3]) { p.push({ kind: 'box', p: [x, 1.03, -0.3], s: [0.6, 0.04, 0.42], color: '#39414d' }); p.push({ kind: 'box', p: [x, 1.23, -0.52], s: [0.6, 0.4, 0.03], color: '#39414d', rotX: -0.25 }); }
    // флагшток
    p.push({ kind: 'cyl', p: [3.8, 3, 2.6], s: [0.06, 6, 0.08], color: '#e5e7eb', seg: 6 });
    return mergeParts(p);
  }, [team.color]);

  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((s) => {
    if (!glow.current) return;
    const cel = celebrating || events.triumph?.teamId === team.id;
    glow.current.opacity = cel ? 0.55 + Math.sin(s.clock.elapsedTime * 7) * 0.2 : mine ? 0.32 : 0.18;
  });

  return (
    <group position={[slot.x, 0, slot.z]} rotation-y={slot.rot}>
      {geo && <mesh geometry={geo} material={SOLID_MAT} castShadow receiveShadow />}
      <mesh rotation-x={-Math.PI / 2} position-y={0.28}>
        <ringGeometry args={[TEAM_BASE_R + 0.2, TEAM_BASE_R + (mine ? 0.9 : 0.55), 48]} />
        <meshBasicMaterial ref={glow} color={team.color} transparent opacity={0.2} toneMapped={false} />
      </mesh>
      <Flag position={[4.45, 5.4, 2.6]} color={team.color} size={[1.3, 0.85]} reduced={reduced} events={events} strong={celebrating} />
      <Safe>
        <AssetModel id="bench" position={[-1.6, 0.24, 2.4]} rotationY={Math.PI} />
        <AssetModel id="bench" position={[1.6, 0.24, 2.4]} rotationY={Math.PI} />
      </Safe>
      <Html position={[0, 4.6, -0.4]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`base-sign ${mine ? 'mine' : ''} ${celebrating ? 'cel' : ''}`} style={{ borderColor: team.color }}>
          <div className="base-name"><i style={{ background: team.color }}>{team.name.slice(0, 1)}</i>{team.name}{mine && <em>ваша команда</em>}</div>
          <div className="base-meta">★ {team.confirmedPoints} подтверждено · {onlineCount} онлайн</div>
          {(mine || near) && workingOn.length > 0 && <div className="base-task">Работает над: {workingOn.map((t) => `«${t.title.length > 34 ? t.title.slice(0, 32) + '…' : t.title}»`).join(', ')}</div>}
          {mine && myResponses > 0 && <div className="base-resp">Откликов команды: {myResponses}</div>}
        </div>
      </Html>
    </group>
  );
});
