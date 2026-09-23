let cached: boolean | null = null;

/** Есть ли WebGL. При отсутствии приложение автоматически показывает 2D-каталог (ТЗ 5.3). */
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
