import { integratedLufs, truePeak, fromDb, toDb } from '../analysis/metrics';
import { TARGET_LUFS, TRUE_PEAK_CEILING_DBTP } from '../../lib/constants';

export interface LoudnessResult {
  samples: Float32Array;
  /** Gain global appliqué avant limitation, en dB. */
  gainDb: number;
  measuredLufsBefore: number;
  measuredLufsAfter: number;
  truePeakDbAfter: number;
  limiterActive: boolean;
}

/** Bornes de sécurité : on ne remonte pas un fichier quasi muet de 40 dB. */
const MAX_GAIN_DB = 24;
const MIN_GAIN_DB = -24;

const LOOKAHEAD_MS = 3;
const RELEASE_MS = 120;

/**
 * Limiteur à anticipation, deux passes.
 *
 * Passe arrière : le gain commence à descendre *avant* la crête, sur la durée
 * d'anticipation. Passe avant : il remonte doucement. Une réduction appliquée
 * au moment exact de la crête s'entend comme une distorsion ; anticipée, elle
 * ne s'entend pas.
 */
function limit(samples: Float32Array, ceiling: number, sampleRate: number): boolean {
  const n = samples.length;
  if (n === 0) return false;

  const needed = new Float32Array(n);
  let active = false;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > ceiling) {
      needed[i] = ceiling / a;
      active = true;
    } else {
      needed[i] = 1;
    }
  }
  if (!active) return false;

  const lookahead = Math.max(1, Math.round((LOOKAHEAD_MS / 1000) * sampleRate));
  const attackCoeff = Math.exp(-1 / lookahead);
  const releaseCoeff = Math.exp(-1 / ((RELEASE_MS / 1000) * sampleRate));

  for (let i = n - 2; i >= 0; i--) {
    const anticipated = needed[i + 1] * attackCoeff + (1 - attackCoeff);
    if (anticipated < needed[i]) needed[i] = anticipated;
  }

  let gain = 1;
  for (let i = 0; i < n; i++) {
    const target = needed[i];
    gain = target < gain ? target : target + (gain - target) * releaseCoeff;
    samples[i] *= gain;
  }
  return true;
}

/**
 * Normalisation à -16 LUFS, plafond crête vraie -1 dBTP.
 *
 * -16 LUFS, c'est la cible des plateformes de podcast : plus fort que le
 * cinéma, moins fort que la musique compressée. -1 dBTP laisse la marge que
 * réclame un encodage lossy en aval, où la crête reconstruite dépasse la crête
 * échantillon.
 */
export function normalizeLoudness(
  samples: Float32Array,
  sampleRate: number,
  targetLufs = TARGET_LUFS,
  ceilingDbtp = TRUE_PEAK_CEILING_DBTP,
): LoudnessResult {
  const measured = integratedLufs(samples, sampleRate);
  const out = new Float32Array(samples.length);
  out.set(samples);

  if (!Number.isFinite(measured)) {
    return {
      samples: out,
      gainDb: 0,
      measuredLufsBefore: measured,
      measuredLufsAfter: measured,
      truePeakDbAfter: toDb(truePeak(out)),
      limiterActive: false,
    };
  }

  const gainDb = Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, targetLufs - measured));
  const gain = fromDb(gainDb);
  for (let i = 0; i < out.length; i++) out[i] *= gain;

  // Le limiteur travaille sur la crête échantillon, mais le plafond porte sur
  // la crête vraie, qui la dépasse toujours un peu. On part avec 0.4 dB de
  // marge, puis on resserre tant que la mesure inter-échantillon déborde : sur
  // un signal à contenu très aigu, l'écart peut atteindre 1 dB.
  const ceilingLinear = fromDb(ceilingDbtp);
  let ceiling = ceilingLinear * 0.955;
  let limiterActive = limit(out, ceiling, sampleRate);

  let peakNow = truePeak(out);
  for (let pass = 0; pass < 3 && peakNow > ceilingLinear; pass++) {
    ceiling *= ceilingLinear / peakNow;
    limiterActive = limit(out, ceiling, sampleRate) || limiterActive;
    peakNow = truePeak(out);
  }

  // Le limiteur a mangé un peu de loudness. On corrige, sans jamais repasser
  // au-dessus du plafond.
  let measuredAfter = integratedLufs(out, sampleRate);
  if (Number.isFinite(measuredAfter)) {
    const drift = targetLufs - measuredAfter;
    if (drift > 0.2) {
      const headroomDb = toDb(ceilingLinear / Math.max(peakNow, 1e-9));
      const correction = Math.min(drift, Math.max(0, headroomDb));
      if (correction > 0.05) {
        const g = fromDb(correction);
        for (let i = 0; i < out.length; i++) out[i] *= g;
        measuredAfter = integratedLufs(out, sampleRate);
        peakNow *= g;
      }
    }
  }

  return {
    samples: out,
    gainDb,
    measuredLufsBefore: measured,
    measuredLufsAfter: measuredAfter,
    truePeakDbAfter: toDb(peakNow),
    limiterActive,
  };
}
