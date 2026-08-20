import { describe, it, expect } from 'vitest';
import { spectralGate } from '../stages/spectralGate';
import { rms, toDb } from '../analysis/metrics';

const SR = 48_000;

/** Générateur déterministe : un test qui échoue une fois sur dix n'est pas un test. */
function whiteNoise(seconds: number, amplitude: number, seed = 7): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((s / 0x7fffffff) * 2 - 1) * amplitude;
  }
  return out;
}

function tone(hz: number, seconds: number, amplitude: number): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

describe('spectralGate', () => {
  it('réduit du bruit blanc pur à presque rien', () => {
    const noise = whiteNoise(3, 0.1);
    const cleaned = spectralGate(noise, SR, { strength: 1 });
    const reduction = toDb(rms(cleaned)) - toDb(rms(noise));
    // Le plancher de masque est à -18 dB : c'est la limite théorique, et on
    // ne cherche pas à la dépasser — c'est elle qui évite le « musical noise ».
    expect(reduction).toBeLessThan(-14);
  });

  it('conserve la longueur et ne produit ni NaN ni infini', () => {
    const input = whiteNoise(1.5, 0.05);
    const out = spectralGate(input, SR, { strength: 0.85 });
    expect(out.length).toBe(input.length);
    for (let i = 0; i < out.length; i += 97) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });

  it('garde le signal utile et ne retire que le fond', () => {
    // Salves de 700 Hz séparées de blancs — c'est le profil d'une prise de
    // voix, et c'est ce qui permet d'estimer le bruit là où il est seul.
    // Fondus de 20 ms aux bords : une coupure franche produirait un clic,
    // c'est-à-dire du large bande, c'est-à-dire exactement ce qu'on mesure.
    const seconds = 4;
    const signal = tone(700, seconds, 0.25);
    const fade = Math.round(0.02 * SR);
    for (let i = 0; i < signal.length; i++) {
      const phase = (i % SR) / SR;
      const burstStart = 0;
      const burstEnd = 0.5;
      if (phase < burstStart || phase >= burstEnd) {
        signal[i] = 0;
        continue;
      }
      const posInBurst = i % SR;
      const endOfBurst = burstEnd * SR;
      const ramp = Math.min(posInBurst, endOfBurst - posInBurst);
      if (ramp < fade) signal[i] *= 0.5 * (1 - Math.cos((Math.PI * ramp) / fade));
    }
    const noise = whiteNoise(seconds, 0.0125);
    const mixed = Float32Array.from(signal, (v, i) => v + noise[i]);

    const cleaned = spectralGate(mixed, SR, { strength: 0.85 });

    // Niveau des salves : la porteuse doit survivre presque intacte.
    const sliceRms = (x: Float32Array, from: number, to: number): number =>
      rms(x.subarray(Math.round(from * SR), Math.round(to * SR)));

    let burstChange = 0;
    for (let sec = 0; sec < seconds; sec++) {
      burstChange += toDb(sliceRms(cleaned, sec + 0.1, sec + 0.4)) -
        toDb(sliceRms(mixed, sec + 0.1, sec + 0.4));
    }
    expect(burstChange / seconds).toBeGreaterThan(-1.5);

    // Niveau des blancs : c'est là que le bruit doit disparaître.
    let silenceChange = 0;
    for (let sec = 0; sec < seconds; sec++) {
      silenceChange += toDb(sliceRms(cleaned, sec + 0.6, sec + 0.95)) -
        toDb(sliceRms(mixed, sec + 0.6, sec + 0.95));
    }
    expect(silenceChange / seconds).toBeLessThan(-10);
  });

  it('laisse passer un signal plus court qu’une trame', () => {
    const tiny = whiteNoise(0.01, 0.1);
    const out = spectralGate(tiny, SR);
    expect(out.length).toBe(tiny.length);
    expect(out[0]).toBe(tiny[0]);
  });

  it('atténue d’autant plus que le dosage est fort', () => {
    const noise = whiteNoise(2, 0.1);
    const gentle = toDb(rms(spectralGate(noise, SR, { strength: 0.2 })));
    const strong = toDb(rms(spectralGate(noise, SR, { strength: 1 })));
    expect(strong).toBeLessThan(gentle - 4);
  });
});
