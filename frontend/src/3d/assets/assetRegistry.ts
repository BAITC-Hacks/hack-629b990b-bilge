// Single registry of the campus 3D assets. File names come from the asset inventories (mini-inventory.txt, modern-list.txt).
// Scale is set per kit so proportions are consistent: a Kenney Mini character ≈ 1.8 m.
// Medieval/fantasy/rustic models (Mini Dungeon, Mini Arena, Mini Forest tents) are not used on the campus.

export type AssetCategory =
  | 'character' | 'building-mid' | 'building-tall' | 'building-far' | 'street' | 'vegetation'
  | 'vehicle' | 'prop-market' | 'prop-tech' | 'prop-decor' | 'prop-skate';

export interface AssetDef {
  id: string;
  url: string;
  category: AssetCategory;
  /** Model scale (from file units to scene meters). */
  scale: number;
  /** Obstacle radius for the player, m (0 — doesn't block walking). */
  collider: number;
  shadow: boolean;
}

const MINI = 2.3;   // Kenney Mini: character 0.78 units → 1.8 m
const CITY = 9;     // Kenney City Kit: building-a 1.29 units → ~11.6 m (3 floors)
const CAR = 1.6;    // Kenney Car Kit: sedan 2.55 units → ~4.1 m
const KAY = 4.5;    // KayKit City Bits: bench 0.40 units → 1.8 m

const defs: AssetDef[] = [];
const add = (id: string, url: string, category: AssetCategory, scale: number, collider = 0, shadow = true) =>
  defs.push({ id, url, category, scale, collider, shadow });

// characters
for (const n of ['male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f', 'female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f'])
  add(`char-${n}`, `/models/mini/characters/character-${n}.glb`, 'character', MINI);
add('char-employee', '/models/mini/market/character-employee.glb', 'character', MINI);
add('char-gamer', '/models/mini/arcade/character-gamer.glb', 'character', MINI);
add('char-skate-boy', '/models/mini/skate/character-skate-boy.glb', 'character', MINI);
add('char-skate-girl', '/models/mini/skate/character-skate-girl.glb', 'character', MINI);

// buildings: mid-rise (block frame) and tall (background only)
for (const c of 'abcdefghijklmn') add(`bld-${c}`, `/models/city/building-${c}.glb`, 'building-mid', CITY, 0, true);
for (const c of 'abcde') add(`tower-${c}`, `/models/city/building-skyscraper-${c}.glb`, 'building-tall', CITY, 0, false);
for (const c of 'abcdefghijklm') add(`far-${c}`, `/models/city/low-detail-building-${c}.glb`, 'building-far', CITY, 0, false);
add('far-wide-a', '/models/city/low-detail-building-wide-a.glb', 'building-far', CITY, 0, false);
add('far-wide-b', '/models/city/low-detail-building-wide-b.glb', 'building-far', CITY, 0, false);
add('awning', '/models/city/detail-awning.glb', 'prop-decor', CITY * 0.6);
add('awning-wide', '/models/city/detail-awning-wide.glb', 'prop-decor', CITY * 0.6);
add('parasol-a', '/models/city/detail-parasol-a.glb', 'prop-market', CITY * 0.6, 0.6);
add('parasol-b', '/models/city/detail-parasol-b.glb', 'prop-market', CITY * 0.6, 0.6);

// street
add('bench', '/models/kaykit/bench.gltf', 'street', KAY);
add('bush', '/models/kaykit/bush.gltf', 'vegetation', KAY);
add('streetlight', '/models/kaykit/streetlight.gltf', 'street', KAY, 0.25);
add('trafficlight-a', '/models/kaykit/trafficlight_A.gltf', 'street', KAY, 0.25);
add('trafficlight-b', '/models/kaykit/trafficlight_B.gltf', 'street', KAY, 0.25);
add('trafficlight-c', '/models/kaykit/trafficlight_C.gltf', 'street', KAY, 0.3);
add('hydrant', '/models/kaykit/firehydrant.gltf', 'street', KAY);
add('dumpster', '/models/kaykit/dumpster.gltf', 'street', KAY, 1.2);
add('watertower', '/models/kaykit/watertower.gltf', 'prop-decor', KAY * 2.2, 0, false);

// plants and rocks
add('tree', '/models/mini/forest/tree.glb', 'vegetation', MINI, 0.5);
add('tree-high', '/models/mini/forest/tree-high.glb', 'vegetation', MINI, 0.5);
add('tree-round', '/models/mini/arena/tree.glb', 'vegetation', MINI, 0.5);
add('plant', '/models/mini/forest/plant.glb', 'vegetation', MINI);
add('patch-grass', '/models/mini/forest/patch-grass.glb', 'vegetation', MINI, 0, false);
add('rocks-low', '/models/mini/forest/rocks-low.glb', 'prop-decor', MINI, 0.8);
add('stones', '/models/mini/forest/stones.glb', 'prop-decor', MINI);

// vehicles
for (const n of ['sedan', 'taxi', 'van', 'suv', 'delivery', 'hatchback-sports', 'police', 'ambulance', 'garbage-truck', 'truck'])
  add(`car-${n}`, `/models/car/${n}.glb`, 'vehicle', CAR, 1.6);
add('cone', '/models/car/cone.glb', 'prop-decor', CAR * 0.9);
add('crate', '/models/car/box.glb', 'prop-decor', CAR * 1.2, 0.5);

// shop, tech, skate park
add('display-fruit', '/models/mini/market/display-fruit.glb', 'prop-market', MINI, 0.6);
add('display-bread', '/models/mini/market/display-bread.glb', 'prop-market', MINI, 0.6);
add('shopping-cart', '/models/mini/market/shopping-cart.glb', 'prop-market', MINI);
add('bottle-return', '/models/mini/market/bottle-return.glb', 'prop-market', MINI, 0.4);
add('freezer', '/models/mini/market/freezer.glb', 'prop-market', MINI, 0.6);
add('vending', '/models/mini/arcade/vending-machine.glb', 'prop-tech', MINI, 0.5);
add('arcade', '/models/mini/arcade/arcade-machine.glb', 'prop-tech', MINI, 0.5);
add('dance', '/models/mini/arcade/dance-machine.glb', 'prop-tech', MINI, 0.8);
add('claw', '/models/mini/arcade/claw-machine.glb', 'prop-tech', MINI, 0.6);
add('ticket', '/models/mini/arcade/ticket-machine.glb', 'prop-tech', MINI, 0.4);
add('pallet', '/models/mini/skate/pallet.glb', 'prop-decor', MINI * 1.6);
add('half-pipe', '/models/mini/skate/half-pipe.glb', 'prop-skate', MINI * 2, 2);
add('skate-box', '/models/mini/skate/obstacle-box.glb', 'prop-skate', MINI * 2, 1.5);
add('skate-rail', '/models/mini/skate/rail-low.glb', 'prop-skate', MINI * 2);
add('skate-steps', '/models/mini/skate/steps.glb', 'prop-skate', MINI * 2, 1.5);
add('skate-platform', '/models/mini/skate/structure-platform.glb', 'prop-skate', MINI * 2, 1.5);
add('skateboard', '/models/mini/skate/skateboard.glb', 'prop-skate', MINI);
add('trophy', '/models/mini/arena/trophy.glb', 'prop-decor', MINI * 1.4);

export const ASSETS: Record<string, AssetDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export type AssetId = keyof typeof ASSETS & string;

export function asset(id: string): AssetDef {
  const a = ASSETS[id];
  if (!a) throw new Error(`Asset not found in registry: ${id}`);
  return a;
}
export function assetsBy(category: AssetCategory): AssetDef[] {
  return defs.filter((d) => d.category === category);
}
/** Player look (key from src/shared/world.ts AVATARS) → model. */
export function characterUrl(avatarPreset: string): string {
  return (ASSETS[`char-${avatarPreset}`] ?? ASSETS['char-male-a']).url;
}
/** Models for decorative NPCs — they differ from players by having no team badge or name. */
export const NPC_CHARACTERS = ['char-employee', 'char-gamer', 'char-skate-boy', 'char-skate-girl'];
