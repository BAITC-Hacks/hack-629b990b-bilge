// Аватар игрока: персонаж Kenney Mini + общий стиль команды (кепка цвета команды, кристалл-символ над головой,
// кольцо под ногами; у своей команды — двойное яркое кольцо). Анимация выбирается функцией clip() каждый кадр.
// Если модель не загрузилась — простая фигура того же цвета.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Safe } from '../assets/AssetModel';
import { characterUrl } from '../assets/assetRegistry';

export const HEIGHT = 1.8;

/** Имена клипов из GLB Kenney Mini Characters (проверены по файлу). Эмоции — ближайшие доступные позы. */
export type Clip = 'idle' | 'walk' | 'sprint' | 'sit' | 'jump' | 'crouch' | 'pick-up' | 'emote-yes' | 'emote-no' | 'interact-right' | 'interact-left' | 'holding-right' | 'holding-both';

function Character({ url, clip, tint }: { url: string; clip: () => Clip; tint: string | null }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => cloneSkinned(gltf.scene) as THREE.Group, [gltf.scene]);
  const group = useRef<THREE.Group>(null);
  const { actions } = useAnimations(gltf.animations, group);
  const current = useRef<string | null>(null);
  const norm = useMemo(() => {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const s = HEIGHT / Math.max(0.01, size.y);
    return { s, top: box.max.y, h: size.y };
  }, [scene]);

  // кепка цвета команды на кости головы — «одинаковый элемент облика» у всех участников команды
  useLayoutEffect(() => {
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    if (!tint) return;
    const head = scene.getObjectByName('head');
    if (!head) return;
    const cap = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.6, flatShading: true });
    const r = norm.h * 0.21;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, r * 0.12, 12, 1, false, -Math.PI / 2, Math.PI), mat);
    brim.position.set(0, 0, r * 0.35);
    cap.add(dome, brim);
    const headWorld = new THREE.Vector3();
    head.getWorldPosition(headWorld);
    const local = head.worldToLocal(new THREE.Vector3(headWorld.x, norm.top - r * 0.55, headWorld.z));
    cap.position.copy(local);
    head.add(cap);
    return () => { head.remove(cap); dome.geometry.dispose(); brim.geometry.dispose(); mat.dispose(); };
  }, [scene, tint, norm]);

  useEffect(() => () => { Object.values(actions).forEach((a) => a?.stop()); }, [actions]);
  useFrame(() => {
    const name = clip();
    if (current.current === name) return;
    const next = actions[name] ?? actions.idle;
    if (!next) return;
    const prev = current.current ? actions[current.current] : null;
    next.reset().fadeIn(0.18).play();
    next.setLoop(name === 'pick-up' || name === 'interact-right' || name === 'interact-left' ? THREE.LoopPingPong : THREE.LoopRepeat, Infinity);
    if (prev && prev !== next) prev.fadeOut(0.18);
    current.current = name;
  });
  return (
    <group ref={group}>
      <primitive object={scene} scale={norm.s} position-y={-(norm.top - norm.h) * norm.s} />
    </group>
  );
}

function Fallback({ color }: { color: string }) {
  return (
    <group>
      <mesh position-y={0.55} castShadow><capsuleGeometry args={[0.32, 0.5, 4, 10]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position-y={1.35} castShadow><sphereGeometry args={[0.3, 12, 10]} /><meshStandardMaterial color="#f2d0b0" /></mesh>
    </group>
  );
}

export type Relation = 'self' | 'teammate' | 'other' | 'guest' | 'business';

interface AvatarProps {
  avatarPreset: string;
  teamColor: string;
  teamName: string | null;
  displayName: string;
  relation: Relation;
  presence?: string;
  demo?: boolean;
  clip: () => Clip;
  /** позиция для LOD таблички (мир) */
  worldPos: React.MutableRefObject<THREE.Vector3>;
}

/** Табличка имени: у своей команды видна дальше; вдали упрощается до точки, затем скрывается. */
export function PlayerAvatar({ avatarPreset, teamColor, teamName, displayName, relation, presence, demo, clip, worldPos }: AvatarProps) {
  const tag = useRef<HTMLDivElement>(null);
  const gem = useRef<THREE.Mesh>(null);
  const frame = useRef(Math.floor(Math.random() * 6));
  const hasTeam = !!teamName;
  const teammate = relation === 'teammate';
  useFrame((state, dt) => {
    if (gem.current) gem.current.rotation.y += dt * 1.5;
    if (++frame.current % 6 !== 0 || !tag.current) return;
    const d = state.camera.position.distanceTo(worldPos.current);
    const full = relation === 'self' ? 0 : teammate ? 38 : 18;
    const mini = relation === 'self' ? 30 : teammate ? 75 : 36;
    const cls = d < full ? 'full' : d < mini ? 'mini' : 'off';
    if (tag.current.dataset.lod !== cls) { tag.current.dataset.lod = cls; tag.current.className = `nameplate ${relation} ${cls}`; }
  });
  const initial = (teamName ?? displayName).slice(0, 1).toUpperCase();
  return (
    <group>
      <Safe fallback={<Fallback color={teamColor} />}>
        <Character url={characterUrl(avatarPreset)} clip={clip} tint={hasTeam ? teamColor : null} />
      </Safe>
      {/* маркер под ногами */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.24}>
        <ringGeometry args={[0.55, teammate || relation === 'self' ? 0.78 : 0.68, 32]} />
        <meshBasicMaterial color={teamColor} transparent opacity={0.9} toneMapped={false} />
      </mesh>
      {(teammate || relation === 'self') && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.23}>
          <ringGeometry args={[0.9, 0.98, 32]} />
          <meshBasicMaterial color={teamColor} transparent opacity={0.55} toneMapped={false} />
        </mesh>
      )}
      {/* символ команды */}
      {hasTeam && (
        <mesh ref={gem} position-y={2.25}>
          <octahedronGeometry args={[0.13, 0]} />
          <meshBasicMaterial color={teamColor} toneMapped={false} />
        </mesh>
      )}
      <Html position={[0, 2.55, 0]} center zIndexRange={[teammate ? 24 : 21, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={tag} className={`nameplate ${relation} mini`} data-lod="mini" style={{ ['--tc' as string]: teamColor }}>
          <span className="np-dot" data-p={presence ?? 'online'} />
          <b>{relation === 'self' ? 'Вы' : displayName}</b>
          {hasTeam && <span className="np-team"><i>{initial}</i>{teamName}</span>}
          {relation === 'business' && <span className="np-team biz">бизнес</span>}
          {demo && <span className="np-demo">демо</span>}
        </div>
      </Html>
    </group>
  );
}

export function preloadCharacters(urls: string[]) { urls.forEach((u) => useGLTF.preload(u)); }
