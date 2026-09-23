// Remote player interpolation buffer: we show the state "slightly in the past" (a delay of ~2 network ticks),
// smoothly blending between the two latest server positions. A large gap gets a soft correction, not a teleport.
export interface Sample { t: number; x: number; z: number; r: number }

export const INTERP_DELAY_MS = 170;
const MAX_SAMPLES = 20;
/** Gap beyond which accelerated correction kicks in (m). */
export const SNAP_DISTANCE = 14;

export class InterpBuffer {
  samples: Sample[] = [];
  push(s: Sample) {
    const last = this.samples[this.samples.length - 1];
    if (last && s.t <= last.t) s = { ...s, t: last.t + 1 };
    this.samples.push(s);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }
  /** Interpolated state at renderTime (ms). */
  sample(renderTime: number): Sample | null {
    const a = this.samples;
    if (!a.length) return null;
    if (renderTime <= a[0].t) return a[0];
    for (let i = a.length - 1; i > 0; i--) {
      const s0 = a[i - 1], s1 = a[i];
      if (renderTime >= s0.t && renderTime <= s1.t) {
        const k = (renderTime - s0.t) / Math.max(1, s1.t - s0.t);
        return { t: renderTime, x: s0.x + (s1.x - s0.x) * k, z: s0.z + (s1.z - s0.z) * k, r: lerpAngle(s0.r, s1.r, k) };
      }
    }
    return a[a.length - 1]; // no newer data — stay at the last point (no jerky extrapolation)
  }
}

export function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * k;
}
