import { describe, it, expect } from 'vitest';
import {
  integratedLufs,
  kWeighting,
  biquadPowerGain,
  truePeak,
  toDb,
  computeMetrics,
} from '../analysis/metrics';

const SR = 48_000;

function sine(hz: number, seconds: number, amplitude: number, sampleRate = SR): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

/**
 * Amplitude d'une sinusoïde à `hz` qui doit produire exactement `targetLufs`.
 *
 * LUFS = −0.691 + 10·log10(G · RMS²) avec G le gain en puissance de la
 * pondération K à cette fréquence, et RMS² = A²/2 pour une sinusoïde.
 */
function amplitudeForLufs(targetLufs: number, hz: number, sampleRate = SR): number {
  const gain = biquadPowerGain(kWeighting(sampleRate), hz, sampleRate);
  const meanSquare = Math.pow(10, (targetLufs + 0.691) / 10) / gain;
  return Math.sqrt(2 * meanSquare);
}

describe('integratedLufs (BS.1770-4)', () => {
  it('lit −23.0 LUFS sur le signal de référence à −23 LUFS', () => {
    const reference = sine(1000, 10, amplitudeForLufs(-23, 1000));
    expect(integratedLufs(reference, SR)).toBeCloseTo(-23, 1);
  });

  it('lit −16.0 LUFS sur un signal calé à la cible du pipeline', () => {
    const reference = sine(1000, 10, amplitudeForLufs(-16, 1000));
    expect(integratedLufs(reference, SR)).toBeCloseTo(-16, 1);
  });

  it('suit une variation de gain décibel pour décibel', () => {
    const base = sine(1000, 8, 0.2);
    const louder = Float32Array.from(base, (v) => v * 2);
    expect(integratedLufs(louder, SR) - integratedLufs(base, SR)).toBeCloseTo(6.02, 1);
  });

  it('donne la même lecture à 44.1 kHz qu’à 48 kHz', () => {
    const a = sine(1000, 6, amplitudeForLufs(-23, 1000, SR), SR);
    const b = sine(1000, 6, amplitudeForLufs(-23, 1000, 44_100), 44_100);
    expect(integratedLufs(b, 44_100)).toBeCloseTo(integratedLufs(a, SR), 1);
  });

  it('ignore les blancs grâce au double portillonnage', () => {
    const tone = sine(1000, 5, amplitudeForLufs(-23, 1000));
    // Même signal, noyé dans autant de silence : la mesure ne doit pas bouger.
    const padded = new Float32Array(tone.length * 2);
    padded.set(tone, 0);
    // Les blocs à cheval sur la transition passent le portillon relatif et
    // tirent légèrement la mesure : 0.2 LU, comme sur n'importe quel mesureur.
    expect(Math.abs(integratedLufs(padded, SR) - integratedLufs(tone, SR))).toBeLessThan(0.2);
  });

  it('renvoie −∞ sur du silence', () => {
    expect(integratedLufs(new Float32Array(SR), SR)).toBe(-Infinity);
  });

  it('applique la pondération K : plateau +4 dB en haut, RLB en bas', () => {
    const filters = kWeighting(SR);
    const db = (hz: number) => 10 * Math.log10(biquadPowerGain(filters, hz, SR));
    // Le plateau est calé sur 1682 Hz : à 1 kHz on n'en a monté qu'une partie.
    expect(db(500)).toBeCloseTo(0, 1);
    expect(db(1000)).toBeCloseTo(0.7, 1);
    expect(db(10_000)).toBeCloseTo(4, 1);
    // Le passe-haut RLB écarte l'infra-grave.
    expect(db(20)).toBeLessThan(-10);
    expect(db(50)).toBeLessThan(-3);
  });
});

describe('truePeak', () => {
  it('colle à la crête échantillon sur un signal grave', () => {
    // 100 Hz à 48 kHz : 480 points par période, la reconstruction ne peut
    // presque rien ajouter entre deux échantillons.
    const low = sine(100, 1, 0.5);
    expect(truePeak(low)).toBeGreaterThanOrEqual(0.5 - 1e-3);
    expect(truePeak(low)).toBeLessThan(0.5 * 1.005);
  });

  it('ne descend jamais sous la crête échantillon', () => {
    const s = sine(3000, 0.5, 0.4);
    let samplePeak = 0;
    for (let i = 0; i < s.length; i++) samplePeak = Math.max(samplePeak, Math.abs(s[i]));
    expect(truePeak(s)).toBeGreaterThanOrEqual(samplePeak);
  });

  it('trouve la crête inter-échantillon d’une sinusoïde mal alignée', () => {
    // 12 kHz à 48 kHz : 4 points par période, les crêtes tombent entre les
    // échantillons. La crête échantillon sous-estime la vraie.
    const n = 4800;
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * 12_000 * i) / SR + Math.PI / 4);
    let samplePeak = 0;
    for (let i = 0; i < n; i++) samplePeak = Math.max(samplePeak, Math.abs(s[i]));
    expect(samplePeak).toBeLessThan(0.72);
    expect(truePeak(s)).toBeGreaterThan(0.85);
  });

  it('renvoie zéro sur du silence', () => {
    expect(truePeak(new Float32Array(480))).toBe(0);
  });
});

describe('computeMetrics', () => {
  it('mesure un rapport parole/silence sur un signal alterné', () => {
    // 8 blocs d'une seconde : parole, silence, parole, silence…
    const out = new Float32Array(SR * 8);
    for (let block = 0; block < 8; block += 2) {
      const tone = sine(220, 1, 0.3);
      out.set(tone, block * SR);
    }
    // Souffle de fond partout, 40 dB sous la parole.
    for (let i = 0; i < out.length; i++) out[i] += (Math.random() * 2 - 1) * 0.003;

    const metrics = computeMetrics(out, SR);
    expect(metrics.snrDb).toBeGreaterThan(20);
    expect(metrics.noiseFloorDb).toBeLessThan(-40);
    expect(metrics.peakDb).toBeGreaterThan(-12);
    expect(Math.abs(metrics.dcOffset)).toBeLessThan(0.01);
    expect(metrics.crestFactorDb).toBeGreaterThan(0);
  });

  it('détecte une composante continue', () => {
    const biased = Float32Array.from(sine(500, 2, 0.2), (v) => v + 0.1);
    expect(computeMetrics(biased, SR).dcOffset).toBeCloseTo(0.1, 2);
  });
});

describe('toDb', () => {
  it('mappe les valeurs usuelles', () => {
    expect(toDb(1)).toBeCloseTo(0, 6);
    expect(toDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(toDb(0)).toBe(-Infinity);
  });
});
