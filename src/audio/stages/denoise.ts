import type { DenoiseMode } from '../types';
import type { VadResult } from '../analysis/vad';
import { spectralGate } from './spectralGate';
import { RnnoiseDenoiser } from '../rnnoise/rnnoise';
import { SAMPLE_RATE } from '../../lib/constants';

export interface DenoiseOptions {
  mode: DenoiseMode;
  strength: number;
  sampleRate: number;
  vad?: VadResult;
  /** URL du module WASM, résolue par le thread principal. */
  rnnoiseUrl?: string;
  onProgress?: (progress: number) => void;
}

export interface DenoiseResult {
  samples: Float32Array;
  /** Ce qui a réellement tourné, qui n'est pas forcément ce qui a été demandé. */
  applied: DenoiseMode;
  notice?: string;
}

/**
 * Aiguillage du débruitage.
 *
 * `neural` peut échouer — pas de réseau, WASM refusé par une politique de
 * sécurité, fréquence d'échantillonnage inattendue. Dans tous ces cas on
 * retombe sur le gate spectral et on le dit, plutôt que d'afficher une erreur
 * pour un résultat qu'on sait produire autrement.
 */
export async function denoise(
  samples: Float32Array,
  options: DenoiseOptions,
): Promise<DenoiseResult> {
  const { mode, strength, sampleRate, vad, rnnoiseUrl, onProgress } = options;

  if (mode === 'off') {
    onProgress?.(1);
    return { samples: Float32Array.from(samples), applied: 'off' };
  }

  const runSpectral = (): Float32Array =>
    spectralGate(samples, sampleRate, { strength, vad, onProgress });

  if (mode === 'soft') {
    return { samples: runSpectral(), applied: 'soft' };
  }

  if (sampleRate !== SAMPLE_RATE) {
    return {
      samples: runSpectral(),
      applied: 'soft',
      notice: `RNNoise exige ${SAMPLE_RATE / 1000} kHz — traitement en mode doux.`,
    };
  }

  if (!rnnoiseUrl) {
    return {
      samples: runSpectral(),
      applied: 'soft',
      notice: 'Module neural indisponible — traitement en mode doux.',
    };
  }

  let denoiser: RnnoiseDenoiser | null = null;
  try {
    denoiser = await RnnoiseDenoiser.create(rnnoiseUrl);
    const result = denoiser.process(samples, strength, onProgress);
    return { samples: result, applied: 'neural' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      samples: runSpectral(),
      applied: 'soft',
      notice: `Modèle neural non chargé (${detail}) — traitement en mode doux.`,
    };
  } finally {
    denoiser?.destroy();
  }
}
