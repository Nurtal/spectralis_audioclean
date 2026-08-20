import { applyBiquad, type Biquad } from '../analysis/metrics';
import { HIGHPASS_HZ } from '../../lib/constants';

/**
 * Passe-haut Butterworth d'ordre 4 : deux biquads en cascade, aux facteurs de
 * qualité qui donnent une réponse plate en bande passante (pas de bosse juste
 * au-dessus de la coupure, contrairement à deux biquads identiques).
 */
const BUTTERWORTH_Q = [0.5411961, 1.3065630];

export function designHighpass(hz: number, sampleRate: number): Biquad[] {
  const w0 = (2 * Math.PI * hz) / sampleRate;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);

  return BUTTERWORTH_Q.map((q) => {
    const alpha = sinw / (2 * q);
    const a0 = 1 + alpha;
    return {
      b0: ((1 + cosw) / 2) / a0,
      b1: (-(1 + cosw)) / a0,
      b2: ((1 + cosw) / 2) / a0,
      a1: (-2 * cosw) / a0,
      a2: (1 - alpha) / a0,
    };
  });
}

/**
 * Coupe ce qui n'est jamais de la voix : rumble de bureau, camion dans la rue,
 * choc de table, coup de vent dans un micro-cravate. Sous 80 Hz une voix
 * parlée n'a rien à dire — même une voix grave d'homme pose son fondamental
 * vers 85–100 Hz.
 */
export function highpass(
  samples: Float32Array,
  sampleRate: number,
  hz = HIGHPASS_HZ,
): Float32Array {
  const out = new Float32Array(samples.length);
  out.set(samples);
  for (const section of designHighpass(hz, sampleRate)) {
    applyBiquad(out, section, out);
  }
  return out;
}
