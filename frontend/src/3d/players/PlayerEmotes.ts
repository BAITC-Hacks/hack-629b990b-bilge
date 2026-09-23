// Эмоции (1–4, синхронизируются) и случайные idle-действия (только визуально, никогда не двигают игрока).
import type { Emote } from '../../shared/types';
import type { Clip } from './PlayerAvatar';

/** Эмоция → ближайший доступный клип Kenney Mini (отдельных клипов «помахать»/«указать» в наборе нет). */
export const EMOTE_CLIP: Record<Emote, Clip> = { wave: 'interact-right', cheer: 'emote-yes', point: 'holding-right', celebrate: 'jump' };
export const EMOTE_KEYS: Record<string, Emote> = { Digit1: 'wave', Digit2: 'cheer', Digit3: 'point', Digit4: 'celebrate', Numpad1: 'wave', Numpad2: 'cheer', Numpad3: 'point', Numpad4: 'celebrate' };

/** Idle-действия: осмотреться, помахать, «потянуться», посмотреть в планшет, присесть рядом с объектом. */
const IDLE_POOL: { clip: Clip; ms: number }[] = [
  { clip: 'emote-no', ms: 2200 },      // посмотреть вокруг
  { clip: 'interact-left', ms: 1800 }, // махнуть рукой
  { clip: 'emote-yes', ms: 1800 },     // потянуться/кивнуть
  { clip: 'holding-both', ms: 3200 },  // посмотреть в планшет
  { clip: 'crouch', ms: 2400 },        // присесть, осмотреть
];

/** Небольшой автомат idle-действий: после паузы без движения иногда включает короткое действие. */
export class IdleActions {
  private idleSince = performance.now();
  private until = 0;
  private nextAt = 0;
  current: Clip | null = null;
  constructor(private startDelay = 6000) { this.nextAt = performance.now() + startDelay; }
  moving() { this.idleSince = performance.now(); this.current = null; this.until = 0; this.nextAt = this.idleSince + this.startDelay; }
  /** sitAvailable — рядом лавочка (только визуально садимся на месте). */
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
