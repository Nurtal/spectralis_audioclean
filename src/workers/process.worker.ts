/// <reference lib="webworker" />
import { runPipeline } from '../audio/pipeline';
import type { FromWorker, ToWorker } from './protocol';
import { transferablesOf } from './protocol';

/**
 * Tout le DSP vit ici.
 *
 * Une FFT sur 90 secondes d'audio gèle le thread principal pendant plusieurs
 * secondes : plus de scroll, plus de bouton, plus d'animation. Le worker n'est
 * pas une optimisation, c'est la condition pour que la page reste vivante.
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let cancelled = new Set<number>();

function post(message: FromWorker): void {
  ctx.postMessage(message, transferablesOf(message));
}

ctx.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    cancelled.add(message.id);
    return;
  }

  if (message.type !== 'process') return;

  const { id, samples, sampleRate, options, rnnoiseUrl } = message;

  try {
    let lastSent = 0;
    const result = await runPipeline(samples, sampleRate, options, {
      rnnoiseUrl,
      onProgress: (stage, progress) => {
        // Un message par pour-cent : au-delà, on sature la file de messages
        // du thread principal pour redessiner les mêmes pixels.
        const now = Math.floor(progress * 100);
        if (now === lastSent && progress < 1) return;
        lastSent = now;
        post({ type: 'progress', id, stage, progress });
      },
    });

    if (cancelled.has(id)) {
      cancelled.delete(id);
      return;
    }

    post({
      type: 'done',
      id,
      processed: result.processed,
      before: result.before,
      after: result.after,
      appliedDenoise: result.appliedDenoise,
      denoiseNotice: result.denoiseNotice,
      loudnessMatchDb: result.loudnessMatchDb,
      elapsedMs: result.elapsedMs,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    post({
      type: 'error',
      id,
      message: detail,
      // Une erreur de traitement laisse le fichier décodé intact : l'utilisateur
      // peut relancer avec d'autres réglages sans tout recommencer.
      recoverable: true,
    });
  }
};
