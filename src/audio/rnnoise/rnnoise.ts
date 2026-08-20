import { loadRnnoise, type RnnoiseModule } from './loader';
import { RNNOISE_FRAME } from '../../lib/constants';

/**
 * Enveloppe RNNoise : Float32Array → Float32Array.
 *
 * Tout ce qui est spécifique au portage WASM est ici, et nulle part ailleurs.
 * Si le paquet change d'API, c'est ce fichier qu'on réécrit — le pipeline ne
 * sait même pas que RNNoise existe, il demande « débruite ça ».
 *
 * Deux pièges, tous les deux payés d'un silence ou d'une saturation totale :
 *   — RNNoise travaille à l'échelle int16, pas dans [-1, 1] ;
 *   — il est figé à 48 kHz mono, trames de 480 échantillons.
 */
const INT16_SCALE = 32768;

export class RnnoiseDenoiser {
  private constructor(
    private readonly module: RnnoiseModule,
    private state: number,
    private readonly inPtr: number,
    private readonly outPtr: number,
  ) {}

  static async create(glueUrl: string): Promise<RnnoiseDenoiser> {
    const module = await loadRnnoise(glueUrl);
    const state = module._rnnoise_create();
    if (!state) throw new Error('RNNoise : création de l’état impossible');
    const bytes = RNNOISE_FRAME * 4;
    const inPtr = module._malloc(bytes);
    const outPtr = module._malloc(bytes);
    if (!inPtr || !outPtr) {
      module._rnnoise_destroy(state);
      throw new Error('RNNoise : allocation impossible');
    }
    return new RnnoiseDenoiser(module, state, inPtr, outPtr);
  }

  /**
   * @param mix 1 = sortie entièrement débruitée, 0 = signal d'origine.
   *            Le mélange sert de dosage : à 0.85 il reste un fond de pièce,
   *            ce qui sonne plus naturel qu'un silence numérique.
   */
  process(samples: Float32Array, mix = 1, onProgress?: (p: number) => void): Float32Array {
    const n = samples.length;
    const out = new Float32Array(n);
    const frames = Math.ceil(n / RNNOISE_FRAME);
    const heapIn = this.inPtr >> 2;
    const heapOut = this.outPtr >> 2;
    const dry = 1 - mix;

    for (let f = 0; f < frames; f++) {
      const start = f * RNNOISE_FRAME;
      const heap = this.module.HEAPF32;

      // Dernière trame partielle : bourrage de zéros, puis troncature en sortie.
      for (let i = 0; i < RNNOISE_FRAME; i++) {
        const idx = start + i;
        heap[heapIn + i] = idx < n ? samples[idx] * INT16_SCALE : 0;
      }

      this.module._rnnoise_process_frame(this.state, this.outPtr, this.inPtr);

      // HEAPF32 peut avoir été remplacé si le tas a grandi : on le relit.
      const heapAfter = this.module.HEAPF32;
      const end = Math.min(RNNOISE_FRAME, n - start);
      for (let i = 0; i < end; i++) {
        const wet = heapAfter[heapOut + i] / INT16_SCALE;
        out[start + i] = wet * mix + samples[start + i] * dry;
      }

      if (onProgress && (f & 63) === 0) onProgress(f / frames);
    }

    onProgress?.(1);
    return out;
  }

  destroy(): void {
    if (this.state) {
      this.module._rnnoise_destroy(this.state);
      this.state = 0;
      this.module._free(this.inPtr);
      this.module._free(this.outPtr);
    }
  }
}
