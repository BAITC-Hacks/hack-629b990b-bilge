// Emotes (1–4, synced) and random idle actions (purely visual, never move the player).
import type { Emote } from '../../shared/types';
import type { Clip } from './PlayerAvatar';

/** Emote → closest available Kenney Mini clip (the kit has no dedicated "wave"/"point" clips). */
export const EMOTE_CLIP: Record<Emote, Clip> = { wave: 'interact-right', cheer: 'emote-yes', point: 'holding-right', celebrate: 'jump' };
export const EMOTE_KEYS: Record<string, Emote> = { Digit1: 'wave', Digit2: 'cheer', Digit3: 'point', Digit4: 'celebrate', Numpad1: 'wave', Numpad2: 'cheer', Numpad3: 'point', Numpad4: 'celebrate' };

/** Idle actions: look around, wave, "stretch", check a tablet, crouch next to an object. */
const IDLE_POOL: { clip: Clip; ms: number }[] = [
  { clip: 'emote-no', ms: 2200 },      // look around
  { clip: 'interact-left', ms: 1800 }, // wave a hand
  { clip: 'emote-yes', ms: 1800 },     // stretch/nod
  { clip: 'holding-both', ms: 3200 },  // look at a tablet
  { clip: 'crouch', ms: 2400 },        // crouch, inspect
];

/** A small idle-action state machine: after a pause without movement it sometimes plays a short action. */
export class IdleActions {
  private idleSince = performance.now();
  private until = 0;
  private nextAt = 0;
  current: Clip | null = null;
  constructor(private startDelay = 6000) { this.nextAt = performance.now() + startDelay; }
  moving() { this.idleSince = performance.now(); this.current = null; this.until = 0; this.nextAt = this.idleSince + this.startDelay; }
  /** sitAvailable — a bench is nearby (we only visually sit in place). */
  update(now: number, sitAvailable = false): Clip | null {
    if (this.current && now < this.until) return this.current;
    this.current = null;
    if (now >= this.nextAt && now - this.idleSince > this.startDelay) {
      const pick = sitAvailable && Math.random() < 0.35 ? { clip: 'sit' as Clip, ms: 6000 } : IDLE_POOL[Math.floor(Math.random() * IDLE_POOL.length)];
      this.current = pick.clip;
      this.until = now + pick.ms;
      this.nextAt = this.until + 4000 + Math.random() * 5000;
    }
    return this.current;
  }
}
