let cached: boolean | null = null;

/** Whether WebGL is available. Without it the app automatically shows the 2D catalog (spec 5.3). */
export function hasWebGL(): boolean {
  if (cached !== null) return cached;
  try {
    const c = document.createElement('canvas');
    cached = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    cached = false;
  }
  return cached;
}
