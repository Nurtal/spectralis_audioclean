/** Fenêtres d'analyse, mises en cache par taille. */

const hannCache = new Map<number, Float32Array>();
const hammingCache = new Map<number, Float32Array>();

/** Hann périodique (division par N, pas N-1) : c'est la variante qui se
 *  recompose proprement en overlap-add. */
export function hann(size: number): Float32Array {
  let w = hannCache.get(size);
  if (w) return w;
  w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
  }
  hannCache.set(size, w);
  return w;
}

export function hamming(size: number): Float32Array {
  let w = hammingCache.get(size);
  if (w) return w;
  w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / size);
  }
  hammingCache.set(size, w);
  return w;
}
