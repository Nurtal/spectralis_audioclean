/**
 * Estimation du plancher de bruit.
 *
 * Principe unique aux deux usages : on prend le percentile 10. La voix est
 * intermittente ; les 10 % les plus faibles d'une prise, ce sont les blancs,
 * donc le bruit. C'est plus robuste qu'un minimum (un seul creux fausse tout)
 * et ça ne demande aucune détection préalable.
 */

/** Percentile générique, tableau non trié, sans le copier deux fois. */
export function percentile(values: Float32Array, p: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values);
  sorted.sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Profil de bruit par bin, à partir d'une matrice de magnitudes STFT.
 *
 * @param frames magnitudes, `frameCount` trames de `bins` valeurs, à plat
 * @param frameMask si fourni, seules les trames marquées `1` comptent
 *                  (typiquement : les trames non-parole du VAD)
 */
export function noiseProfileFromFrames(
  frames: Float32Array,
  frameCount: number,
  bins: number,
  frameMask?: Uint8Array,
  p = 10,
): Float32Array {
  const profile = new Float32Array(bins);
  if (frameCount === 0) return profile;

  let usable = frameCount;
  if (frameMask) {
    usable = 0;
    for (let f = 0; f < frameCount; f++) if (frameMask[f]) usable++;
    // Sous 8 trames de silence, l'estimation est trop bruitée : on retombe
    // sur la totalité du fichier plutôt que de sortir un profil au hasard.
    if (usable < 8) {
      frameMask = undefined;
      usable = frameCount;
    }
  }

  const column = new Float32Array(usable);
  for (let b = 0; b < bins; b++) {
    let k = 0;
    for (let f = 0; f < frameCount; f++) {
      if (frameMask && !frameMask[f]) continue;
      column[k++] = frames[f * bins + b];
    }
    profile[b] = percentile(column, p);
  }
  return profile;
}

/** Plancher de bruit global en dBFS : percentile 10 des RMS de trame. */
export function estimateNoiseFloorDb(
  samples: Float32Array,
  sampleRate: number,
  frameMs = 20,
): number {
  const frame = Math.max(1, Math.round((frameMs / 1000) * sampleRate));
  const count = Math.floor(samples.length / frame);
  if (count === 0) return -Infinity;

  const rms = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    let sum = 0;
    const start = f * frame;
    for (let i = 0; i < frame; i++) {
      const v = samples[start + i];
      sum += v * v;
    }
    rms[f] = Math.sqrt(sum / frame);
  }
  const floor = percentile(rms, 10);
  return floor > 0 ? 20 * Math.log10(floor) : -Infinity;
}
