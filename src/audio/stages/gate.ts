import { estimateNoiseFloorDb } from '../analysis/noiseFloor';
import { fromDb } from '../analysis/metrics';

export interface GateOptions {
  /** Combien de dB au-dessus du plancher mesuré on ouvre. */
  thresholdOverFloorDb?: number;
  /** Atténuation maximale appliquée en position fermée. */
  rangeDb?: number;
  attackMs?: number;
  holdMs?: number;
  releaseMs?: number;
}

/**
 * Noise gate à seuil adaptatif.
 *
 * Le seuil n'est pas un réglage : il se déduit du plancher de bruit mesuré sur
 * le fichier. Et le gate n'écrase pas, il atténue — une fermeture totale
 * s'entend comme un trou, on plafonne donc l'atténuation à -18 dB. Ce qui
 * reste sonne comme une pièce calme, pas comme une coupure de ligne.
 */
export function gate(
  samples: Float32Array,
  sampleRate: number,
  options: GateOptions = {},
): Float32Array {
  const {
    thresholdOverFloorDb = 6,
    rangeDb = -18,
    attackMs = 4,
    holdMs = 90,
    releaseMs = 160,
  } = options;

  const floorDb = estimateNoiseFloorDb(samples, sampleRate);
  if (!Number.isFinite(floorDb)) return Float32Array.from(samples);

  const openThreshold = fromDb(floorDb + thresholdOverFloorDb);
  const closeThreshold = fromDb(floorDb + thresholdOverFloorDb - 3);
  const floorGain = fromDb(rangeDb);

  // Les durées sont des temps de trajet, pas des constantes de temps : une
  // exponentielle de constante τ met environ 4τ à arriver. « Release 160 ms »
  // doit vouloir dire « fermé au bout de 160 ms », pas « au bout de 800 ».
  const timeConstant = (ms: number) => Math.exp(-4 / ((ms / 1000) * sampleRate));
  const attack = timeConstant(attackMs);
  const release = timeConstant(releaseMs);
  const holdSamples = Math.round((holdMs / 1000) * sampleRate);

  // Détecteur en valeur efficace sur une fenêtre glissante centrée de 10 ms,
  // pas en crête. Le seuil vient d'un plancher mesuré en RMS ; comparer une
  // crête à un RMS se trompe de 5 dB sur du bruit large bande, et le gate
  // reste alors ouvert en permanence. La fenêtre étant centrée, le détecteur
  // voit l'attaque du mot avant qu'elle n'arrive : c'est gratuit hors ligne,
  // et ça évite de raboter la première consonne.
  const half = Math.max(1, Math.round(0.005 * sampleRate));
  const windowLength = half * 2 + 1;
  const n = samples.length;
  let running = 0;
  for (let i = 0; i <= Math.min(half, n - 1); i++) running += samples[i] * samples[i];

  const out = new Float32Array(n);
  let gain = floorGain;
  let hold = 0;

  for (let i = 0; i < n; i++) {
    const x = samples[i];
    const env = Math.sqrt(running / windowLength);

    let target: number;
    if (env > openThreshold) {
      target = 1;
      hold = holdSamples;
    } else if (hold > 0) {
      target = 1;
      hold--;
    } else {
      target = env > closeThreshold ? gain : floorGain;
    }

    const coeff = target > gain ? attack : release;
    gain = target + (gain - target) * coeff;
    out[i] = x * gain;

    // Glissement de la fenêtre : on ajoute devant, on retire derrière.
    const entering = i + half + 1;
    if (entering < n) running += samples[entering] * samples[entering];
    const leaving = i - half;
    if (leaving >= 0) running -= samples[leaving] * samples[leaving];
  }

  return out;
}
