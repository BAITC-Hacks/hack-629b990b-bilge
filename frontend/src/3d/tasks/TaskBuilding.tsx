// A task building in the city. It stands out from decorative buildings through several layers:
// an HTML marker (title, score, level in words), a vertical beacon, a rotating ring at the base, an [E] hint,
// flags of selected teams, a trophy after a confirmed result. The readiness level changes the styling, not the size.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldTask } from '../../shared/types';
import { glowMaterial, mergeParts, SOLID_MAT } from '../performance/mergeParts';
import { BEACON_HEIGHT, LEVEL_COLOR, LEVEL_INDEX, PRESET_LABEL, generateBuilding, generatePavilion } from './TaskBuildingGenerator';
import type { TaskPlacement } from '../world/WorldLayout';
import type { WorldEventManager } from '../events/WorldEventManager';
import { Flag } from '../world/TriumphPlaza';
import { AssetModel, Safe } from '../assets/AssetModel';
import type { LabelBudget, LabelLod } from './LabelBudget';

const LEVEL_ICON: Record<string, string> = { draft: '◌', work: '◐', ready: '●', priority: '★' };

interface Props {
  task: WorldTask;
  place: TaskPlacement;
  selected: boolean;
  near: boolean;
  myTeamResponded: boolean;
  myTeamSelected: boolean;
  reduced: boolean;
  events: WorldEventManager;
  onSelect: (id: string) => void;
  dragRef: React.MutableRefObject<{ moved: boolean }>;
  budget: LabelBudget;
  /** in map mode building labels are hidden — the map has its own pins */
  hideLabel: boolean;
}

export const TaskBuilding = memo(function TaskBuilding({ task, place, selected, near, myTeamResponded, myTeamSelected, reduced, events, onSelect, dragRef, budget, hideLabel }: Props) {
  const lv = task.score.levelKey;
  const L = LEVEL_INDEX[lv];
  const spec = useMemo(() => (place.featured ? generatePavilion(lv) : generateBuilding(place.preset, lv, place.seed)), [place.featured, place.preset, place.seed, lv]);
  const solidGeo = useMemo(() => mergeParts(spec.solid), [spec]);
  const glowGeo = useMemo(() => mergeParts(spec.glow), [spec]);
  const glowMat = useMemo(() => glowMaterial(0.8), []);
  useEffect(() => () => { solidGeo?.dispose(); glowGeo?.dispose(); glowMat.dispose(); }, [solidGeo, glowGeo, glowMat]);

  const beacon = useRef<THREE.Mesh>(null);
  const beaconMat = useRef<THREE.MeshBasicMaterial>(null);
  const ring = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const shownScore = useRef(reduced ? task.score.total : 0);
  const root = useRef<THREE.Group>(null);
  const [budgetLod, setBudgetLod] = useState<LabelLod>('hidden');
  const [triumphHere, setTriumphHere] = useState(false);
  const [hover, setHover] = useState(false);
  useEffect(() => budget.register(task.id, place.x, place.z, setBudgetLod), [budget, task.id, place.x, place.z]);
  const lod: LabelLod = hideLabel ? 'hidden' : selected || near || hover || triumphHere ? 'full' : budgetLod;
  const completed = task.approvedMilestones > 0;
  const ringR = place.featured ? 4.9 : 6.4;
  const beaconH = BEACON_HEIGHT[lv];

  useEffect(() => events.subscribe(() => setTriumphHere(events.triumph?.taskId === task.id)), [events, task.id]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const tri = triumphHere ? events.triumphProgress() : -1;
    // beacon: height by level, soft pulsing; shoots up during a triumph
    if (beacon.current && beaconMat.current) {
      const up = tri >= 0 ? 1 + Math.min(1, tri * 4) * 1.6 : 1;
      beacon.current.scale.set(1, up, 1);
      beacon.current.position.y = spec.height + (beaconH * up) / 2;
      const pulse = reduced ? 0 : Math.sin(t * (L >= 2 ? 1.4 : 0.8) + place.seed) * 0.05;
      beaconMat.current.opacity = (tri >= 0 ? 0.6 : [0.12, 0.2, 0.3, 0.38][L]) + pulse;
    }
    if (ring.current && !reduced) ring.current.rotation.y += dt * (0.25 + L * 0.12);
    // windows: live light (slightly varying), brighter for ready tasks, a flash during a triumph
    const flicker = reduced ? 0 : Math.sin(t * 0.6 + place.seed * 0.001) * 0.04;
    const sparkle = events.ambient.some((e) => e.kind === 'sparkle' && e.target === task.id) ? 0.3 + Math.sin(t * 8) * 0.2 : 0;
    glowMat.color.setScalar(tri >= 0 ? 1.5 + Math.sin(t * 10) * 0.2 : [0.62, 0.8, 0.92, 1][L] + flicker + sparkle + (hover || selected ? 0.12 : 0));
    // core of the main pavilion (Core_Fill)
    if (core.current) {
      shownScore.current += (task.score.total - shownScore.current) * (reduced ? 1 : Math.min(1, dt / 0.25));
      const h = Math.max(0.05, (shownScore.current / 100) * 3.4);
      core.current.scale.y = h;
      core.current.position.y = 0.6 + h / 2;
    }
  });

  const click = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (dragRef.current.moved) return;
    onSelect(task.id);
  };
  const levelColor = LEVEL_COLOR[lv];
  const title = task.title.length > 30 && lod !== 'full' ? task.title.slice(0, 28) + '…' : task.title;

  return (
    <group position={[place.x, 0, place.z]} rotation-y={place.rot}>
      <group
        ref={root}
        name={place.featured ? 'Pavilion' : 'TaskBuilding'}
        onClick={click}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}
      >
        {solidGeo && <mesh geometry={solidGeo} material={SOLID_MAT} castShadow receiveShadow />}
        {glowGeo && <mesh geometry={glowGeo} material={glowMat} />}
        {place.featured && (
          <>
            <mesh position={[0, 2.3, 0]}><cylinderGeometry args={[1, 1, 3.6, 20, 1, true]} /><meshStandardMaterial color="#e0fbf7" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} /></mesh>
            <mesh ref={core} name="Core_Fill"><cylinderGeometry args={[0.8, 0.8, 1, 20]} /><meshStandardMaterial color="#14b8a6" emissive="#14b8a6" emissiveIntensity={0.25 + L * 0.2} /></mesh>
          </>
        )}
      </group>

      {/* Ring_Approved/base: rotating arcs — number of arcs = level (not only color) */}
      <group ref={ring} name="Ring_Approved" position-y={0.22}>
        {Array.from({ length: L + 1 }, (_, i) => (
          <mesh key={i} rotation-x={-Math.PI / 2} rotation-z={(i / (L + 1)) * Math.PI * 2}>
            <ringGeometry args={[ringR, ringR + (selected ? 0.34 : 0.22), 40, 1, 0, (Math.PI * 2) / (L + 1) * 0.72]} />
            <meshBasicMaterial color={selected ? '#14b8a6' : levelColor} transparent opacity={selected || near ? 0.95 : 0.7} toneMapped={false} />
          </mesh>
        ))}
      </group>

      {/* Beacon */}
      <mesh ref={beacon} name="Beacon" position-y={spec.height + beaconH / 2}>
        <cylinderGeometry args={[0.28 + L * 0.08, 0.7 + L * 0.12, beaconH, 16, 1, true]} />
        <meshBasicMaterial ref={beaconMat} color={L >= 2 ? '#7cf2e4' : levelColor} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* flags of selected teams — a visual link between the task and the team */}
      {task.selectedTeams.map((tm, i) => (
        <group key={tm.id} position={[spec.flagAt[0] - i * 1.5, 0, spec.flagAt[1]]}>
          <mesh position-y={2.4} castShadow><cylinderGeometry args={[0.05, 0.06, 4.8, 6]} /><meshStandardMaterial color="#e5e7eb" /></mesh>
          <Flag position={[0.55, 4.25, 0]} color={tm.color} size={[1.1, 0.72]} reduced={reduced} events={events} strong={triumphHere} />
        </group>
      ))}
      {completed && (
        <Safe><AssetModel id="trophy" position={[0, spec.height + 0.3, place.featured ? 0 : -0.6]} rotationY={0} scale={1.4} /></Safe>
      )}

      {/* Anchor_Label: HTML marker; how many labels are visible is decided by the shared budget (LabelBudget) */}
      {lod === 'chip' && (
        <Html name="Anchor_Label" position={[0, spec.height + 1.6, 0]} center zIndexRange={[16, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`tb-chip lvl-${lv}`} title={task.title}><span aria-hidden>{LEVEL_ICON[lv]}</span>{task.score.total}</div>
        </Html>
      )}
      {(lod === 'full' || lod === 'mini') && (
        <Html name="Anchor_Label" position={[0, spec.height + 2.1, 0]} center zIndexRange={[lod === 'full' ? 25 : 18, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`tb-label lvl-${lv} ${lod} ${selected ? 'sel' : ''} ${triumphHere ? 'triumph' : ''}`}>
            {triumphHere && <div className="tb-done">TASK COMPLETED</div>}
            {lod === 'full' && <div className="tb-kicker">{place.featured ? 'Featured task' : PRESET_LABEL[place.preset]}{task.industry ? ` · ${task.industry}` : ''}</div>}
            <div className="tb-title">{title}</div>
            <div className="tb-score"><span aria-hidden>{LEVEL_ICON[lv]}</span> {lod === 'full' ? `${task.score.level} · ` : ''}{task.score.total}/100</div>
            {lod === 'full' && (
              <div className="tb-chips">
                {task.offersCount > 0 && <span>{task.offersCount} {plural(task.offersCount, 'team interested', 'teams interested')}</span>}
                {myTeamResponded && <span className="mine">Your team applied</span>}
                {myTeamSelected && <span className="mine">Your team was selected</span>}
                {task.selectedTeams.map((t) => <span key={t.id} className="team"><i style={{ background: t.color }} />{t.name}</span>)}
                {completed && <span className="done">🏆 Result confirmed</span>}
                {task.inReview && <span className="pending">Milestone in review</span>}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
});

function plural(n: number, one: string, other: string) {
  return n === 1 ? one : other;
}
