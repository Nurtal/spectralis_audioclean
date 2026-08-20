import type { VadSegment } from '../types';
import { percentile } from './noiseFloor';

/**
 * Détection d'activité vocale, énergie + hystérésis.
 *
 * On ne cherche pas à distinguer la voix d'un autre son : on cherche à savoir
 * où il se passe quelque chose, pour pouvoir mesurer le bruit ailleurs. Le
 * seuil est relatif au plancher estimé, donc indépendant du niveau du fichier.
 */

const FRAME_MS = 20;
const HOP_MS = 10;
/** Ouverture : combien de dB au-dessus du plancher. */
const OPEN_OVER_FLOOR_DB = 9;
/** Fermeture plus bas que l'ouverture : évite le battement sur les fins de mot. */
const HYSTERESIS_DB = 4;
/** On garde le segment ouvert un peu après la dernière trame active. */
const HANGOVER_MS = 180;
/** En dessous, c'est un claquement, pas de la parole. */
const MIN_SPEECH_MS = 90;

export interface VadResult {
  segments: VadSegment[];
  speechRatio: number;
  /** Masque par trame STFT, aligné sur `hop` (voir `speechMaskForHop`). */
  frameActive: Uint8Array;
  frameHopS: number;
  floorDb: number;
}

export function detectVoiceActivity(samples: Float32Array, sampleRate: number): VadResult {
  const frame = Math.max(1, Math.round((FRAME_MS / 1000) * sampleRate));
  const hop = Math.max(1, Math.round((HOP_MS / 1000) * sampleRate));
  const count = Math.max(0, Math.floor((samples.length - frame) / hop) + 1);

  if (count <= 0) {
    return {
      segments: [],
      speechRatio: 0,
      frameActive: new Uint8Array(0),
      frameHopS: hop / sampleRate,
      floorDb: -Infinity,
    };
  }

  const levelDb = new Float32Array(count);
  const rms = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    const start = f * hop;
    let sum = 0;
    for (let i = 0; i < frame; i++) {
      const v = samples[start + i];
      sum += v * v;
    }
    const r = Math.sqrt(sum / frame);
    rms[f] = r;
    levelDb[f] = r > 1e-10 ? 20 * Math.log10(r) : -200;
  }

  const floorDb = 20 * Math.log10(Math.max(percentile(rms, 10), 1e-10));
  const peakDb = 20 * Math.log10(Math.max(percentile(rms, 95), 1e-10));

  // Sur un fichier sans dynamique (plancher et crête confondus), tout ou rien
  // n'aurait pas de sens : on place le seuil à mi-chemin.
  const span = peakDb - floorDb;
  const openDb =
    span < OPEN_OVER_FLOOR_DB * 1.5 ? floorDb + span * 0.5 : floorDb + OPEN_OVER_FLOOR_DB;
  const closeDb = openDb - HYSTERESIS_DB;

  const hangoverFrames = Math.round(HANGOVER_MS / HOP_MS);
  const active = new Uint8Array(count);
  let open = false;
  let silentRun = 0;
  for (let f = 0; f < count; f++) {
    if (open) {
      if (levelDb[f] < closeDb) {
        silentRun++;
        if (silentRun > hangoverFrames) {
          open = false;
          // On retire la traîne de silence ajoutée par le hangover.
          for (let k = f - silentRun + 1; k <= f; k++) if (k >= 0) active[k] = 0;
        }
      } else {
        silentRun = 0;
      }
    } else if (levelDb[f] > openDb) {
      open = true;
      silentRun = 0;
    }
    if (open) active[f] = 1;
  }

  const minFrames = Math.round(MIN_SPEECH_MS / HOP_MS);
  const segments: VadSegment[] = [];
  let runStart = -1;
  for (let f = 0; f <= count; f++) {
    const on = f < count && active[f] === 1;
    if (on && runStart < 0) runStart = f;
    if (!on && runStart >= 0) {
      const length = f - runStart;
      if (length >= minFrames) {
        segments.push({
          start: (runStart * hop) / sampleRate,
          end: (f * hop + frame) / sampleRate,
        });
      } else {
        for (let k = runStart; k < f; k++) active[k] = 0;
      }
      runStart = -1;
    }
  }

  let activeFrames = 0;
  for (let f = 0; f < count; f++) activeFrames += active[f];

  return {
    segments,
    speechRatio: count > 0 ? activeFrames / count : 0,
    frameActive: active,
    frameHopS: hop / sampleRate,
    floorDb,
  };
}

/**
 * Ré-échantillonne le masque VAD sur la grille de trames d'une STFT donnée,
 * et l'inverse : le résultat marque les trames **sans** parole, celles qui
 * servent à estimer le bruit.
 */
export function silenceMaskForHop(
  vad: VadResult,
  frameCount: number,
  hopS: number,
): Uint8Array {
  const mask = new Uint8Array(frameCount);
  if (vad.frameActive.length === 0) {
    mask.fill(1);
    return mask;
  }
  for (let f = 0; f < frameCount; f++) {
    const t = f * hopS;
    const src = Math.min(vad.frameActive.length - 1, Math.round(t / vad.frameHopS));
    mask[f] = vad.frameActive[src] ? 0 : 1;
  }
  return mask;
}
