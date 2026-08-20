import { describe, it, expect } from 'vitest';
import { highpass, designHighpass } from '../stages/highpass';
import { gate } from '../stages/gate';
import { deesser } from '../stages/deesser';
import { normalizeLoudness } from '../stages/loudness';
import { biquadPowerGain, rms, toDb, truePeak, integratedLufs } from '../analysis/metrics';
import { TARGET_LUFS, TRUE_PEAK_CEILING_DBTP } from '../../lib/constants';

const SR = 48_000;

function tone(hz: number, seconds: number, amplitude: number): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

function noise(seconds: number, amplitude: number, seed = 3): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((s / 0x7fffffff) * 2 - 1) * amplitude;
  }
  return out;
}

describe('highpass', () => {
  it('est plat au-dessus de la coupure, raide en dessous', () => {
    const sections = designHighpass(80, SR);
    const db = (hz: number) => 10 * Math.log10(biquadPowerGain(sections, hz, SR));
    expect(db(80)).toBeCloseTo(-3, 0); // définition de la fréquence de coupure
    expect(db(1000)).toBeCloseTo(0, 1);
    expect(db(200)).toBeGreaterThan(-1);
    // Ordre 4 : 24 dB par octave. Une octave sous la coupure, on y est.
    expect(db(40)).toBeLessThan(-20);
    expect(db(20)).toBeLessThan(-45);
  });

  it('efface un rumble sans toucher à la voix', () => {
    const voice = tone(300, 2, 0.3);
    const rumble = tone(35, 2, 0.3);
    const mixed = Float32Array.from(voice, (v, i) => v + rumble[i]);
    const cleaned = highpass(mixed, SR);
    // Il ne doit plus rester que la porteuse à 300 Hz, à son niveau d'origine.
    expect(toDb(rms(cleaned)) - toDb(rms(voice))).toBeGreaterThan(-0.5);
    expect(toDb(rms(cleaned)) - toDb(rms(voice))).toBeLessThan(0.5);
  });
});

describe('gate', () => {
  it('atténue les blancs sans les couper net', () => {
    const seconds = 6;
    const out = new Float32Array(SR * seconds);
    // Une seconde de parole, une seconde de silence, en alternance.
    for (let sec = 0; sec < seconds; sec += 2) {
      out.set(tone(200, 1, 0.3), sec * SR);
    }
    const bed = noise(seconds, 0.01);
    for (let i = 0; i < out.length; i++) out[i] += bed[i];

    const gated = gate(out, SR);
    const slice = (x: Float32Array, from: number, to: number) =>
      toDb(rms(x.subarray(Math.round(from * SR), Math.round(to * SR))));

    // Une fois le blanc installé : le fond descend, mais pas jusqu'à zéro —
    // le gate plafonne son atténuation à -18 dB, sinon le trou s'entend.
    const settled = slice(gated, 1.3, 1.8) - slice(out, 1.3, 1.8);
    expect(settled).toBeLessThan(-15);
    expect(settled).toBeGreaterThan(-20);

    // La parole ne bouge pas.
    expect(slice(gated, 0.2, 0.9) - slice(out, 0.2, 0.9)).toBeGreaterThan(-0.5);

    // La descente est progressive : à 50 ms de la fin du mot, on n'a pas
    // encore refermé. Une coupure franche s'entendrait comme un clic.
    expect(slice(gated, 1.0, 1.05) - slice(out, 1.0, 1.05)).toBeGreaterThan(-3);

    // Et surtout : les 20 premières millisecondes du mot suivant sortent
    // intactes. Le détecteur est centré, il voit l'attaque arriver — un gate
    // qui rouvre après coup mange la consonne initiale.
    expect(slice(gated, 2.0, 2.02) - slice(out, 2.0, 2.02)).toBeGreaterThan(-1);
  });
});

describe('deesser', () => {
  it('n’agit que sur la bande des sifflantes', () => {
    const voice = tone(400, 2, 0.3);
    const untouched = deesser(voice, SR);
    expect(toDb(rms(untouched)) - toDb(rms(voice))).toBeGreaterThan(-0.5);

    // Même signal avec une salve à 7 kHz : là, il doit réagir.
    const sibilant = Float32Array.from(voice);
    const start = SR;
    const burst = tone(7000, 0.4, 0.5);
    for (let i = 0; i < burst.length; i++) sibilant[start + i] += burst[i];

    const treated = deesser(sibilant, SR);
    const burstBefore = toDb(rms(sibilant.subarray(start, start + burst.length)));
    const burstAfter = toDb(rms(treated.subarray(start, start + burst.length)));
    expect(burstAfter - burstBefore).toBeLessThan(-2);
  });
});

describe('normalizeLoudness', () => {
  it('atteint la cible et respecte le plafond de crête vraie', () => {
    const quiet = tone(500, 8, 0.02);
    const result = normalizeLoudness(quiet, SR);
    expect(result.measuredLufsAfter).toBeCloseTo(TARGET_LUFS, 0);
    expect(toDb(truePeak(result.samples))).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DBTP + 0.05);
    expect(result.gainDb).toBeGreaterThan(0);
  });

  it('redescend un fichier trop fort', () => {
    const loud = tone(500, 8, 0.9);
    const result = normalizeLoudness(loud, SR);
    expect(result.gainDb).toBeLessThan(0);
    expect(integratedLufs(result.samples, SR)).toBeCloseTo(TARGET_LUFS, 0);
    expect(toDb(truePeak(result.samples))).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DBTP + 0.05);
  });

  it('écrête les crêtes isolées sans écraser le reste', () => {
    const s = tone(300, 6, 0.15);
    // Une crête isolée bien au-dessus du reste.
    for (let i = 0; i < 40; i++) s[SR * 3 + i] = 0.99;

    const result = normalizeLoudness(s, SR);
    expect(result.limiterActive).toBe(true);
    expect(toDb(truePeak(result.samples))).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DBTP + 0.05);
    // Le corps du signal, loin de la crête, garde son niveau relatif.
    const bodyBefore = toDb(rms(s.subarray(0, SR)));
    const bodyAfter = toDb(rms(result.samples.subarray(0, SR)));
    expect(bodyAfter - bodyBefore).toBeCloseTo(result.gainDb, 0);
  });

  it('ne touche pas au silence', () => {
    const silence = new Float32Array(SR);
    const result = normalizeLoudness(silence, SR);
    expect(result.gainDb).toBe(0);
    expect(result.samples.every((v) => v === 0)).toBe(true);
  });
});
