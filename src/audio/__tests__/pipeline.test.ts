import { describe, it, expect } from 'vitest';
import { runPipeline, analyze } from '../pipeline';
import { DEFAULT_OPTIONS, type StageName } from '../types';
import { TARGET_LUFS, TRUE_PEAK_CEILING_DBTP } from '../../lib/constants';

const SR = 48_000;

/** Prise de voix synthétique : des salves harmoniques sur un lit de souffle. */
function fakeRecording(seconds = 6): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let seed = 99;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const speaking = t % 2 < 1.2;
    if (speaking) {
      const f0 = 130 + 20 * Math.sin(2 * Math.PI * 3 * t);
      out[i] =
        0.22 * Math.sin(2 * Math.PI * f0 * t) +
        0.10 * Math.sin(2 * Math.PI * f0 * 2 * t) +
        0.05 * Math.sin(2 * Math.PI * f0 * 3 * t);
      // Enveloppe syllabique, pour que le VAD ait quelque chose à mordre.
      out[i] *= 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t);
    }
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const white = (seed / 0x7fffffff) * 2 - 1;
    // Souffle large bande + ronflement de 50 Hz, les deux classiques.
    out[i] += white * 0.012 + 0.01 * Math.sin(2 * Math.PI * 50 * t);
  }
  return out;
}

describe('runPipeline', () => {
  it('nettoie, normalise et rend compte', async () => {
    const input = fakeRecording();
    const stages: StageName[] = [];
    let lastProgress = -1;
    let monotone = true;

    const result = await runPipeline(
      input,
      SR,
      { ...DEFAULT_OPTIONS, denoise: 'soft' },
      {
        onProgress: (stage, progress) => {
          if (stages[stages.length - 1] !== stage) stages.push(stage);
          if (progress < lastProgress - 1e-6) monotone = false;
          lastProgress = progress;
        },
      },
    );

    expect(result.processed.length).toBe(input.length);
    expect(monotone).toBe(true);
    expect(lastProgress).toBeCloseTo(1, 5);
    expect(stages[0]).toBe('analyse-source');
    expect(stages[stages.length - 1]).toBe('analyse-resultat');
    expect(stages).toContain('debruitage');
    expect(stages).toContain('normalisation');

    // Le résultat est calé sur la cible et sous le plafond.
    expect(result.after.metrics.lufs).toBeCloseTo(TARGET_LUFS, 0);
    expect(result.after.metrics.truePeakDb).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DBTP + 0.05);

    // Le bruit a baissé, et il a baissé plus que le signal n'a monté.
    const floorGain = result.after.metrics.noiseFloorDb - result.before.metrics.noiseFloorDb;
    const levelGain = result.after.metrics.lufs - result.before.metrics.lufs;
    expect(floorGain).toBeLessThan(levelGain - 10);
    expect(result.after.metrics.snrDb).toBeGreaterThan(result.before.metrics.snrDb + 5);

    // Compensation A/B : de quoi ramener le traité au niveau de l'original.
    expect(Number.isFinite(result.loudnessMatchDb)).toBe(true);
    expect(result.loudnessMatchDb).toBeCloseTo(
      result.before.metrics.lufs - result.after.metrics.lufs,
      6,
    );
  });

  it('retombe sur le mode doux quand le module neural est absent', async () => {
    const result = await runPipeline(
      fakeRecording(2),
      SR,
      { ...DEFAULT_OPTIONS, denoise: 'neural' },
      {},
    );
    expect(result.appliedDenoise).toBe('soft');
    expect(result.denoiseNotice).toBeTruthy();
  });

  it('laisse le signal intact quand toutes les étapes sont désactivées', async () => {
    const input = fakeRecording(2);
    const result = await runPipeline(
      input,
      SR,
      {
        denoise: 'off',
        strength: 0,
        highpass: false,
        deesser: false,
        gate: false,
        loudness: false,
      },
      {},
    );
    for (let i = 0; i < input.length; i += 331) {
      expect(result.processed[i]).toBe(input[i]);
    }
    expect(result.loudnessMatchDb).toBeCloseTo(0, 6);
  });
});

describe('analyze', () => {
  it('produit des analyses de dimensions cohérentes', () => {
    const analysis = analyze(fakeRecording(3), SR);
    expect(analysis.peaks.length).toBe(analysis.peakCount * 2);
    expect(analysis.spectrogram.data.length).toBe(
      analysis.spectrogram.width * analysis.spectrogram.height,
    );
    expect(analysis.durationS).toBeCloseTo(3, 2);
    expect(analysis.sampleRate).toBe(SR);
    // Une prise qui parle 60 % du temps doit être détectée comme telle.
    expect(analysis.speechRatio).toBeGreaterThan(0.4);
    expect(analysis.speechRatio).toBeLessThan(0.85);
    expect(analysis.vad.length).toBeGreaterThan(0);
  });

  it('ne détecte aucune parole dans du silence', () => {
    const analysis = analyze(new Float32Array(SR), SR);
    expect(analysis.vad.length).toBe(0);
    expect(analysis.speechRatio).toBe(0);
  });
});
