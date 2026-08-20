import { applyBiquad, rms, type Biquad } from '../analysis/metrics';
import { percentile } from '../analysis/noiseFloor';
import { DEESSER_LOW_HZ, DEESSER_HIGH_HZ } from '../../lib/constants';

export interface DeesserOptions {
  /** Combien de dB au-dessus du niveau moyen de la bande on commence à agir. */
  thresholdOverBandDb?: number;
  ratio?: number;
  attackMs?: number;
  releaseMs?: number;
  /** Réduction maximale, pour ne jamais zozoter à l'envers. */
  maxReductionDb?: number;
}

function bandpass(lowHz: number, highHz: number, sampleRate: number): Biquad {
  const center = Math.sqrt(lowHz * highHz);
  const q = center / (highHz - lowHz);
  const w0 = (2 * Math.PI * center) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * Math.cos(w0)) / a0,
    a2: (1 - alpha) / a0,
  };
}

/**
 * De-esser par soustraction dynamique.
 *
 * On isole la bande des sifflantes, on mesure son enveloppe, et on ne retire du
 * signal que l'excès : `out = x − (1 − g)·bande`. Compresser la bande puis la
 * remélanger déphaserait le reste du spectre ; ici le signal n'est touché que
 * quand la bande dépasse, et seulement de ce qu'elle dépasse.
 *
 * Le seuil est relatif au niveau *médian* de la bande, pas à sa moyenne : une
 * sifflante est brève, elle tire la moyenne vers le haut et finirait par fixer
 * son propre seuil. La médiane décrit la brillance ordinaire de la voix ; on
 * n'agit qu'au-dessus. Une voix naturellement claire ne se fait donc pas
 * raboter comme une voix sifflante.
 */
export function deesser(
  samples: Float32Array,
  sampleRate: number,
  options: DeesserOptions = {},
): Float32Array {
  const {
    thresholdOverBandDb = 9,
    ratio = 4,
    attackMs = 1,
    releaseMs = 60,
    maxReductionDb = -12,
  } = options;

  const high = Math.min(DEESSER_HIGH_HZ, sampleRate / 2 - 500);
  if (high <= DEESSER_LOW_HZ) return Float32Array.from(samples);

  const band = new Float32Array(samples.length);
  applyBiquad(samples, bandpass(DEESSER_LOW_HZ, high, sampleRate), band);

  const bandRms = rms(band);
  if (bandRms <= 1e-8) return Float32Array.from(samples);

  // Niveau médian de la bande, mesuré sur des trames de 20 ms.
  const frame = Math.round(0.02 * sampleRate);
  const frameCount = Math.floor(band.length / frame);
  let median = bandRms;
  if (frameCount >= 8) {
    const levels = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      let sum = 0;
      for (let i = 0; i < frame; i++) {
        const v = band[f * frame + i];
        sum += v * v;
      }
      levels[f] = Math.sqrt(sum / frame);
    }
    median = percentile(levels, 50);
  }

  // Garde-fou : sur une prise très sourde, la médiane peut être quasi nulle et
  // le seuil s'effondrer. Il ne descend jamais sous le niveau moyen de la bande.
  const threshold = Math.max(median * Math.pow(10, thresholdOverBandDb / 20), bandRms);
  const minGain = Math.pow(10, maxReductionDb / 20);
  const exponent = 1 - 1 / ratio;
  const attack = Math.exp(-1 / ((attackMs / 1000) * sampleRate));
  const release = Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  const detectAttack = Math.exp(-1 / (0.0005 * sampleRate));
  const detectRelease = Math.exp(-1 / (0.020 * sampleRate));

  const out = new Float32Array(samples.length);
  let meanSquare = 0;
  let gain = 1;

  for (let i = 0; i < samples.length; i++) {
    const b = band[i];
    const square = b * b;
    const detect = square > meanSquare ? detectAttack : detectRelease;
    meanSquare = square + (meanSquare - square) * detect;
    const env = Math.sqrt(meanSquare);

    // Le gain de compression s'écrit directement (seuil/env)^(1−1/ratio) :
    // c'est la même chose qu'un aller-retour en décibels, sans les logarithmes,
    // et ça compte quand la boucle tourne quatre millions de fois.
    let target = env > threshold ? Math.pow(threshold / env, exponent) : 1;
    if (target < minGain) target = minGain;

    const coeff = target < gain ? attack : release;
    gain = target + (gain - target) * coeff;

    out[i] = samples[i] - (1 - gain) * b;
  }

  return out;
}
