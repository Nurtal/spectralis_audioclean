/** Petits utilitaires de rendu canvas, partagés par la waveform et le spectrogramme. */

export interface CanvasSize {
  cssWidth: number;
  cssHeight: number;
  ratio: number;
}

/**
 * Dimensionne le canvas au `devicePixelRatio` et remet l'échelle du contexte.
 *
 * Sans ça, un tracé d'un pixel est flou sur tout écran moderne — et une page
 * qui prétend mesurer quelque chose n'a pas le droit d'être floue.
 * Renvoie `null` si rien n'a changé, pour éviter de vider le canvas pour rien.
 */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): CanvasSize {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  return { cssWidth, cssHeight, ratio };
}

/** Lit une variable CSS résolue sur un élément. */
export function cssVar(element: Element, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim();
}

/** `#rrggbb` → `[r, g, b]`. Les tokens du projet sont tous en hexadécimal. */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function rgbString(rgb: [number, number, number], alpha = 1): string {
  return alpha >= 1
    ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * Anime une valeur de 0 à 1 et rappelle à chaque trame.
 * Renvoie la fonction d'annulation. Durée nulle : un seul appel, à 1.
 */
export function tween(durationMs: number, onFrame: (t: number) => void): () => void {
  if (durationMs <= 0) {
    onFrame(1);
    return () => {};
  }
  const start = performance.now();
  let frame = 0;
  const step = () => {
    const elapsed = performance.now() - start;
    const t = Math.min(1, elapsed / durationMs);
    onFrame(t);
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/**
 * Observe la largeur d'un élément et la renvoie en pixels CSS.
 * Utilisé pour redessiner les canvas au redimensionnement.
 */
export function observeSize(
  element: Element,
  onResize: (width: number, height: number) => void,
): () => void {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = entry.contentRect;
      onResize(box.width, box.height);
    }
  });
  observer.observe(element);
  return () => observer.disconnect();
}
