/** Formatage des mesures. Toujours en mono espacé côté CSS, jamais d'arrondi menteur. */

export function formatDb(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '−∞';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

export function formatLufs(value: number): string {
  if (!Number.isFinite(value)) return '−∞';
  return minus(value.toFixed(1));
}

/**
 * Trait d'union-moins ASCII → vrai signe moins (U+2212).
 * Le tiret du clavier est plus court et plus bas que les chiffres : dans une
 * colonne de mesures, il se voit.
 */
export function minus(text: string): string {
  return text.replace(/-/g, '\u2212');
}

export function formatDelta(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return `0.${'0'.repeat(digits)}`;
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(digits)}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatHz(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function formatRatio(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return minus(value.toFixed(digits));
}
