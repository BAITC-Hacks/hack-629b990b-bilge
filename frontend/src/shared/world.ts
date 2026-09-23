// Multiplayer world constants shared by server and client.
import type { Emote } from './types';

/** Half the side of the walkable area (campus ~150×150 + a reserve row of plots; beyond the edge — backdrop and fog). */
export const WORLD_HALF = 88;
/** Network movement update rate, Hz. */
export const NET_HZ = 12;
export const WALK_SPEED = 4.6;
export const RUN_SPEED = 7.2;
export const EMOTES: Emote[] = ['wave', 'cheer', 'point', 'celebrate'];
export const EMOTE_LABEL: Record<Emote, string> = { wave: 'Wave', cheer: 'Cheer', point: 'Point', celebrate: 'Celebrate' };
export const EMOTE_MS: Record<Emote, number> = { wave: 2200, cheer: 2200, point: 2000, celebrate: 3200 };

/** Kenney Mini Characters the server picks a player's look from (stable per userId). */
export const AVATARS = ['male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f', 'female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f'] as const;

export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Deterministic generator (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function avatarFor(userId: string): string {
  return AVATARS[hash32(userId) % AVATARS.length];
}
