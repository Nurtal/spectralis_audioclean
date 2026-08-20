import type { AudioAnalysis, DenoiseMode, PipelineOptions, StageName } from '../audio/types';

/**
 * Messages échangés entre le thread principal et le worker de traitement.
 *
 * Chaque requête porte un `id` : quand l'utilisateur change de mode pendant un
 * traitement, le résultat de l'ancien arrive quand même. Sans identifiant, il
 * écraserait le nouveau. Avec, on le jette.
 */

export type ToWorker =
  | {
      type: 'process';
      id: number;
      samples: Float32Array;
      sampleRate: number;
      options: PipelineOptions;
      /** Résolue côté page : le worker ne connaît pas `document.baseURI`. */
      rnnoiseUrl?: string;
    }
  | { type: 'cancel'; id: number };

export type FromWorker =
  | { type: 'progress'; id: number; stage: StageName; progress: number }
  | {
      type: 'done';
      id: number;
      processed: Float32Array;
      before: AudioAnalysis;
      after: AudioAnalysis;
      appliedDenoise: DenoiseMode;
      denoiseNotice?: string;
      loudnessMatchDb: number;
      elapsedMs: number;
    }
  | { type: 'error'; id: number; message: string; recoverable: boolean };

/**
 * Buffers à transférer plutôt qu'à cloner. Une analyse pèse quelques centaines
 * de kilo-octets, le signal traité plusieurs mégaoctets : les copier deux fois
 * par traitement se voit à l'œil nu.
 */
export function transferablesOf(message: FromWorker): ArrayBuffer[] {
  if (message.type !== 'done') return [];
  const buffers: ArrayBuffer[] = [message.processed.buffer as ArrayBuffer];
  for (const analysis of [message.before, message.after]) {
    buffers.push(analysis.peaks.buffer as ArrayBuffer);
    buffers.push(analysis.spectrogram.data.buffer as ArrayBuffer);
  }
  return buffers;
}
