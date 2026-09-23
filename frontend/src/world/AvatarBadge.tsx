// 2D-значок готового стилизованного аватара (без фото и биометрии, ТЗ 2).
export const AVATAR_PRESETS: Record<string, { label: string; glyph: string }> = {
  explorer: { label: 'Исследователь', glyph: '🧭' },
  robot: { label: 'Робот', glyph: '🤖' },
  astronaut: { label: 'Астронавт', glyph: '🚀' },
  ninja: { label: 'Ниндзя', glyph: '🥷' },
  wizard: { label: 'Маг', glyph: '🪄' },
  guest: { label: 'Гость', glyph: '👀' },
};

export function AvatarBadge({ preset, color }: { preset: string; color: string }) {
  const p = AVATAR_PRESETS[preset] ?? AVATAR_PRESETS.guest;
  return (
    <span className="avatar-badge" style={{ background: color }} title={p.label} aria-label={p.label}>
      {p.glyph}
    </span>
  );
}
