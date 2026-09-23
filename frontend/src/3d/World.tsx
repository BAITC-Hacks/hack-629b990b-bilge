// AI Sana World — живой мультиплеерный кампус. Данные задач и команд — те же, что в 2D (снимок с сервера);
// присутствие игроков, эмоции и GRAND TRIUMPH — через Socket.IO. Ходьба, эмоции и онлайн-время баллов не дают.
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import { allCards, api, getWorldName, setToken } from '../api';
import { useApp, usePrefersReducedMotion } from '../state';
import { toWorldTask, type Emote, type WorldTask as PublicTask, type WorldTeam } from '../shared/types';
import { avatarFor, hash32 } from '../shared/world';
import { asset } from './assets/assetRegistry';
import { InstancedGroups, type Placement } from './assets/AssetModel';
import { buildLayout, resolveCollisions, BUILDING_D, PAVILION_R, insideRect, type Collider, type WorldLayout } from './world/WorldLayout';
import { Backdrop, Clouds, Ground, Lights, Sky } from './world/WorldEnvironment';
import { Fountains, HallOfAchievements, Monument, PlazaGreens, Sculptures } from './world/TriumphPlaza';
import { TaskBuilding } from './tasks/TaskBuilding';
import { LabelBudget } from './tasks/LabelBudget';
import { generateBuilding, generatePavilion } from './tasks/TaskBuildingGenerator';
import { TeamBase } from './teams/TeamBase';
import { LocalPlayer, typingTarget, type PlayerRefs } from './players/LocalPlayer';
import { RemotePlayers, usePresence } from './multiplayer/RemotePlayers';
import { MultiplayerManager } from './multiplayer/MultiplayerManager';
import { WorldEventManager } from './events/WorldEventManager';
import { AmbientWorld } from './events/AmbientWorld';
import { TriumphEvent } from './events/TriumphEvent';
import { CameraController, useCameraState, type CameraMode } from './camera/CameraController';
import { WorldMap } from './map/WorldMap';
import { TaskListPanel, TriumphBanner, WorldHUD } from './ui/WorldHUD';
import { TaskDrawer } from './ui/TaskDrawer';
import { DebugOverlay, DebugProbe, TeammateCompass } from './ui/CanvasHelpers';

import './world.css';

const INTRO_KEY = 'sana-world-intro-seen';

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error('3D-сцена не запустилась', e); }
  render() {
    if (this.state.failed) return (
      <div className="world-fail"><h2>3D-мир не запустился на этом устройстве</h2><p>Все задачи и действия доступны в обычном каталоге.</p><Link className="btn" to="/list?nowebgl=1">Открыть 2D-каталог</Link></div>
    );
    return this.props.children;
  }
}

/** Реквизит зданий задач (зонтики, тележки, фургоны…) из генератора → мировые координаты для инстансинга. */
function buildingProps(layout: WorldLayout, tasks: PublicTask[]) {
  const groups: Record<string, Placement[]> = {};
  const colliders: Collider[] = [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const p of layout.placements) {
    const t = byId.get(p.taskId);
    if (!t) continue;
    const spec = p.featured ? generatePavilion(t.score.levelKey) : generateBuilding(p.preset, t.score.levelKey, p.seed);
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    for (const pr of spec.props) {
      const x = p.x + c * pr.x + s * pr.z, z = p.z - s * pr.x + c * pr.z;
      (groups[pr.asset] ??= []).push({ x, z, r: p.rot + pr.r, s: pr.s });
      const r = asset(pr.asset).collider;
      if (r > 0) colliders.push({ kind: 'circle', x, z, r, tag: 'prop' });
    }
  }
  return { groups, colliders };
}

function spawnFor(layout: WorldLayout, role: string | undefined, teamId: string | null, userId: string, colliders: Collider[]): [number, number] {
  const j = (hash32(userId) % 1000) / 1000 - 0.5;
  let x = 0, z = 27;
  const slot = teamId ? layout.byTeam[teamId] : null;
  if (slot) {
    const d = Math.hypot(slot.x, slot.z);
    x = slot.x - (slot.x / d) * 8 + j * 4;
    z = slot.z - (slot.z / d) * 8;
  } else if (role === 'business') { x = j * 6; z = -31; }
  else { x = j * 6; z = 27.5; }
  return resolveCollisions(x, z, colliders, 0.5, layout.walkLimit);
}

export default function World() {
  const { snap, world, revision, refresh } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const reduced = usePrefersReducedMotion();
  const debug = params.get('debug3d') === '1';
  // все опубликованные карточки каталога BFF (не только первая страница) — перечитываются по событиям сервера
  const [tasks, setTasks] = useState<PublicTask[]>([]);
  useEffect(() => { void allCards().then((cards) => setTasks(cards.map(toWorldTask))).catch(() => undefined); }, [revision]);
  const teams: WorldTeam[] = world?.teams ?? [];
  const me = snap?.bootstrap.actor ?? null;
  const myTeam = me?.teamId ? teams.find((t) => t.id === me.teamId) ?? null : null;
  const myName = getWorldName() || me?.displayName || 'Гость';

  // планировка зависит только от набора задач/уровней и команд — детерминированно
  const layoutKey = tasks.map((t) => `${t.id}:${t.score.total}:${t.industry}:${t.publishedAt}`).join('|') + '#' + teams.map((t) => t.id).join(',');
  const layout = useMemo(() => buildLayout(tasks, teams.map((t) => t.id)), [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const bprops = useMemo(() => buildingProps(layout, tasks), [layout, tasks]);
  const colliders = useMemo(() => [...layout.colliders, ...bprops.colliders], [layout, bprops]);
  const staticGroups = useMemo(() => {
    const g: Record<string, Placement[]> = { ...layout.props };
    g.bench = [...(g.bench ?? []), ...layout.benches];
    for (const [id, list] of Object.entries(bprops.groups)) g[id] = [...(g[id] ?? []), ...list];
    for (const b of [...layout.decorBuildings, ...layout.farBuildings]) (g[b.asset] ??= []).push({ x: b.x, z: b.z, r: b.rot, s: b.s });
    return g;
  }, [layout, bprops]);

  // игрок, камера, сеть, события
  const refs: PlayerRefs = { pos: useRef(new THREE.Vector3(0, 0, 27)), rot: useRef(0), movement: useRef('idle') };
  const cam = useCameraState();
  const focus = useRef(new THREE.Vector3());
  const dragRef = useRef({ moved: false });
  const triumphRef = useRef(-1);
  const events = useMemo(() => new WorldEventManager(), []);
  const labels = useMemo(() => new LabelBudget(), []);
  const netRef = useRef<MultiplayerManager | null>(null);
  const [net, setNet] = useState<MultiplayerManager | null>(null);
  const spawn = useMemo(() => spawnFor(layout, me?.role, me?.teamId ?? null, me?.id ?? 'guest', colliders), [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<CameraMode>(() => {
    if (params.get('mode') === 'map') return 'map';
    try { return sessionStorage.getItem(INTRO_KEY) ? 'explore' : 'intro'; } catch { return 'explore'; }
  });
  const [selectedId, setSelectedId] = useState<string | null>(params.get('open'));
  const [nearId, setNearId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const compass = useRef<HTMLDivElement>(null);
  const debugEl = useRef<HTMLPreElement>(null);

  useEffect(() => { cam.current.yaw = Math.atan2(spawn[0], spawn[1]); }, [spawn, cam]);
  useEffect(() => { events.reduced = reduced; }, [events, reduced]);
  useEffect(() => { events.setTasks(tasks.map((t) => t.id)); }, [events, tasks]);
  useEffect(() => { events.startAmbient(); return () => events.stop(); }, [events]);
  useEffect(() => events.subscribe(() => { triumphRef.current = events.triumphProgress(); }), [events]);

  // сеть: вход в мир после загрузки снимка (сервер знает, кто мы, по сессии)
  useEffect(() => {
    if (!snap) return;
    const m = new MultiplayerManager(() => ({ x: refs.pos.current.x, z: refs.pos.current.z, r: refs.rot.current, m: refs.movement.current }));
    m.onTriumph = (t) => events.pushTriumph(t);
    netRef.current = m;
    setNet(m);
    return () => { m.dispose(); netRef.current = null; };
  }, [snap === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = tasks.find((t) => t.id === selectedId) ?? null;
  useEffect(() => { net?.interacting(!!selected); }, [net, selected]);

  const openTask = useCallback((id: string) => {
    setSelectedId(id);
    setListOpen(false);
    const next = new URLSearchParams(params); next.set('open', id); setParams(next, { replace: true });
  }, [params, setParams]);
  const closeTask = useCallback(() => {
    setSelectedId(null);
    const next = new URLSearchParams(params); next.delete('open'); setParams(next, { replace: true });
  }, [params, setParams]);

  const endIntro = useCallback(() => { try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* ok */ } setMode((m) => (m === 'intro' ? 'explore' : m)); }, []);
  const toggleMap = useCallback(() => setMode((m) => (m === 'map' ? 'explore' : 'map')), []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typingTarget(e.target)) return;
      if (e.code === 'KeyM' && !e.repeat) { if (mode === 'intro') endIntro(); toggleMap(); }
      if (e.code === 'Escape') { if (selectedId) closeTask(); else if (listOpen) setListOpen(false); else if (mode === 'map') setMode('explore'); }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [mode, selectedId, listOpen, closeTask, endIntro, toggleMap]);

  const myTeamId = myTeam?.id ?? null;
  const respondedIds = useMemo(() => new Set(snap?.dashboard?.screen === 'team-dashboard' ? snap.dashboard.proposals.map((p) => p.taskId) : []), [snap]);

  const focusMyTeam = useCallback(() => {
    const store = netRef.current?.store;
    const pts: [number, number][] = [[refs.pos.current.x, refs.pos.current.z]];
    if (myTeamId) {
      const s = layout.byTeam[myTeamId];
      if (s) pts.push([s.x, s.z]);
      store?.players.forEach((st) => { if (st.presence.teamId === myTeamId) pts.push([st.presence.position[0], st.presence.position[2]]); });
    }
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 20);
    cam.current.mapTarget = { x: cx, z: cz, zoom: Math.min(1.2, Math.max(0.3, span / 110)) };
    setMode('map');
  }, [layout, myTeamId, cam]); // eslint-disable-line react-hooks/exhaustive-deps

  const emote = useCallback((e: Emote) => { netRef.current?.emote(e); }, []);
  const getYaw = useCallback(() => cam.current.yaw, [cam]);
  const interact = useCallback(() => { if (nearId) openTask(nearId); }, [nearId, openTask]);

  if (!snap) return <div className="page-loading world-loading">Загрузка мира…</div>;

  return (
    <div className="world-root">
      <SceneBoundary>
        <Canvas
          shadows
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          camera={{ fov: 50, near: 0.5, far: 1400, position: [0, 120, 170] }}
          onPointerMissed={() => { /* клик по пустому месту ничего не делает */ }}
        >
          <color attach="background" args={['#d5eaf8']} />
          <fog attach="fog" args={['#d9ecf8', 110, 430]} />
          <Sky />
          <Lights focus={focus} />
          <Ground layout={layout} triumphRef={triumphRef} />
          <Backdrop />
          <Clouds reduced={reduced} />
          <Suspense fallback={null}>
            <InstancedGroups groups={staticGroups} />
          </Suspense>
          <Monument events={events} reduced={reduced} />
          <Fountains events={events} reduced={reduced} />
          <PlazaGreens layout={layout} />
          <Sculptures />
          <HallOfAchievements items={world?.achievements ?? []} />
          {layout.placements.map((p) => {
            const t = tasks.find((x) => x.id === p.taskId);
            if (!t) return null;
            return (
              <TaskBuilding
                key={p.taskId}
                task={t}
                place={p}
                selected={selectedId === t.id}
                near={nearId === t.id}
                myTeamResponded={respondedIds.has(t.id)}
                myTeamSelected={!!myTeamId && t.selectedTeams.some((s) => s.id === myTeamId)}
                reduced={reduced}
                events={events}
                onSelect={openTask}
                dragRef={dragRef}
                budget={labels}
                hideLabel={mode === 'map'}
              />
            );
          })}
          {teams.map((tm) => {
            const slot = layout.byTeam[tm.id];
            if (!slot) return null;
            return (
              <TeamBaseLive
                key={tm.id}
                team={tm}
                slot={slot}
                mine={tm.id === myTeamId}
                net={net}
                tasks={tasks}
                myResponses={tm.id === myTeamId ? respondedIds.size : 0}
                reduced={reduced}
                events={events}
              />
            );
          })}
          <LocalPlayer
            refs={refs}
            start={spawn}
            colliders={colliders}
            limit={layout.walkLimit}
            getYaw={getYaw}
            benches={layout.benches}
            enabled={mode !== 'map' && !selected && !listOpen}
            avatarPreset={avatarFor(`${myTeam?.id ?? me?.role ?? 'guest'}:${myName}`)}
            teamColor={myTeam?.color ?? (me?.role === 'business' ? '#16324f' : '#9aa3b2')}
            teamName={myTeam?.name ?? null}
            displayName={myName}
            relation="self"
            onInteract={interact}
            onEmote={emote}
            onAnyInput={() => { if (mode === 'intro') endIntro(); }}
          />
          {net && <RemotePlayers store={net.store} myTeamId={myTeamId} />}
          <AmbientWorld layout={layout} events={events} reduced={reduced} player={refs.pos} />
          <TriumphEvent events={events} layout={layout} reduced={reduced} />
          <NearProbe layout={layout} player={refs.pos} onNear={setNearId} />
          <LabelBudgetUpdater budget={labels} player={refs.pos} forced={[selectedId, nearId]} />
          {mode === 'map' && net && (
            <WorldMap layout={layout} tasks={tasks} teams={teams} store={net.store} myTeamId={myTeamId} respondedIds={respondedIds} selectedId={selectedId} me={refs.pos} onTask={openTask} />
          )}
          {net && mode !== 'map' && <TeammateCompass store={net.store} myTeamId={myTeamId} me={refs.pos} el={compass} />}
          <CameraController mode={mode} state={cam} player={refs.pos} dragRef={dragRef} reduced={reduced} onIntroEnd={endIntro} tour={{ teamsZ: 57, businessZ: 57 }} focus={focus} />
          {debug && net && <DebugProbe el={debugEl} store={net.store} events={events} net={netRef} me={refs.pos} selected={selectedId} />}
          {debug && <DebugOverlay layout={layout} />}
        </Canvas>
      </SceneBoundary>

      {net && (
        <WorldHUD
          store={net.store}
          me={me ? { displayName: myName, role: me.role, teamId: me.teamId } : null}
          team={myTeam}
          mapMode={mode === 'map'}
          onToggleMap={toggleMap}
          onMyTeam={focusMyTeam}
          onList={() => setListOpen(!listOpen)}
          onEmote={emote}
          onLogout={async () => { await api.endSession().catch(() => undefined); setToken(null); await refresh(); nav('/login'); }}
        />
      )}
      {mode === 'intro' && <button className="intro-skip" onClick={endIntro}>Пропустить облёт</button>}
      {nearId && !selected && mode !== 'map' && (
        <button className="hud-near" onClick={interact}><kbd>E</kbd> Открыть задачу «{tasks.find((t) => t.id === nearId)?.title}»</button>
      )}
      <div ref={compass} className="mate-compass" style={{ display: 'none' }}><i>➜</i><span /></div>
      <TriumphBanner events={events} />
      {listOpen && <TaskListPanel tasks={tasks} onPick={openTask} onClose={() => setListOpen(false)} />}
      {selectedId && <TaskDrawer taskId={selectedId} onClose={closeTask} />}
      {debug && <pre ref={debugEl} className="debug3d" />}
    </div>
  );
}

/** База команды с живым счётчиком онлайн. */
function TeamBaseLive({ team, slot, mine, net, tasks, myResponses, reduced, events }: { team: WorldTeam; slot: WorldLayout['teamSlots'][number]; mine: boolean; net: MultiplayerManager | null; tasks: PublicTask[]; myResponses: number; reduced: boolean; events: WorldEventManager }) {
  const store = net?.store;
  return store ? <TeamBaseCounted team={team} slot={slot} mine={mine} store={store} tasks={tasks} myResponses={myResponses} reduced={reduced} events={events} />
    : <TeamBase team={team} slot={slot} mine={mine} onlineCount={0} workingOn={tasks.filter((t) => t.selectedTeams.some((s) => s.id === team.id))} myResponses={myResponses} reduced={reduced} events={events} celebrating={false} near={false} />;
}
function TeamBaseCounted({ team, slot, mine, store, tasks, myResponses, reduced, events }: { team: WorldTeam; slot: WorldLayout['teamSlots'][number]; mine: boolean; store: import('./multiplayer/PresenceStore').PresenceStore; tasks: PublicTask[]; myResponses: number; reduced: boolean; events: WorldEventManager }) {
  usePresence(store);
  let n = 0;
  store.players.forEach((s) => { if (s.presence.teamId === team.id) n++; });
  const workingOn = useMemo(() => tasks.filter((t) => t.selectedTeams.some((s) => s.id === team.id)), [tasks, team.id]);
  return <TeamBase team={team} slot={slot} mine={mine} onlineCount={n} workingOn={workingOn} myResponses={myResponses} reduced={reduced} events={events} celebrating={events.triumph?.teamId === team.id} near={false} />;
}

/** Раз в ~0,25 с раздаёт подписи зданиям по близости к игроку. */
function LabelBudgetUpdater({ budget, player, forced }: { budget: LabelBudget; player: React.MutableRefObject<THREE.Vector3>; forced: (string | null)[] }) {
  const acc = useRef(1);
  const forcedSet = useMemo(() => new Set(forced.filter((x): x is string => !!x)), [forced.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { acc.current = 1; }, [forcedSet]);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.25) return;
    acc.current = 0;
    budget.update(player.current, forcedSet);
  });
  return null;
}

/** Ближайшая задача для подсказки [E]: у главного павильона — радиус, у здания — перед фасадом. */
function NearProbe({ layout, player, onNear }: { layout: WorldLayout; player: React.MutableRefObject<THREE.Vector3>; onNear: (id: string | null) => void }) {
  const last = useRef<string | null>(null);
  const frame = useRef(0);
  useFrame(() => {
    if (++frame.current % 6 !== 0) return;
    const p = player.current;
    let best: string | null = null, bestD = Infinity;
    for (const pl of layout.placements) {
      let d: number;
      if (pl.featured) d = Math.hypot(p.x - pl.x, p.z - pl.z) - PAVILION_R;
      else d = insideRect(p.x, p.z, { x: pl.x, z: pl.z, hw: 4.5, hd: BUILDING_D / 2, rot: pl.rot }, 3.2) ? Math.hypot(p.x - pl.x, p.z - pl.z) - 4 : Infinity;
      if (d < 3.2 && d < bestD) { bestD = d; best = pl.taskId; }
    }
    if (best !== last.current) { last.current = best; onNear(best); }
  });
  return null;
}
