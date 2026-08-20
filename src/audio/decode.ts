import type { DecodedAudio } from './types';
import { MAX_DURATION_S, MAX_FILE_BYTES, SAMPLE_RATE } from '../lib/constants';
import { formatBytes } from '../lib/format';

export type DecodeErrorCode = 'too-large' | 'empty' | 'unsupported' | 'silent';

export class DecodeError extends Error {
  constructor(
    readonly code: DecodeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DecodeError';
  }
}

/**
 * Le décodage passe par un `OfflineAudioContext`, pas par un `AudioContext`.
 *
 * `decodeAudioData` existe sur les deux, mais un contexte hors-ligne n'a pas
 * besoin d'un geste utilisateur pour démarrer. Un fichier déposé se décode donc
 * immédiatement, y compris sur Safari iOS ; le contexte de lecture, lui, ne
 * sera créé qu'au premier clic sur Écouter.
 */
function decodingContext(): OfflineAudioContext {
  return new OfflineAudioContext(1, 1, SAMPLE_RATE);
}

/**
 * File → signal mono 48 kHz, tronqué à la durée de démo.
 *
 * Rien ne sort de la machine : `decodeAudioData` et `OfflineAudioContext`
 * travaillent en mémoire, dans l'onglet.
 */
export async function decodeFile(
  file: File | Blob,
  name = 'file' in file ? (file as File).name : 'extrait',
): Promise<DecodedAudio> {
  if (file.size === 0) {
    throw new DecodeError('empty', 'Ce fichier est vide.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new DecodeError(
      'too-large',
      `Fichier de ${formatBytes(file.size)} — la démo s'arrête à ${formatBytes(MAX_FILE_BYTES)}. ` +
        'Envoyez un extrait, ou parlons de vos fichiers complets.',
    );
  }

  const bytes = await file.arrayBuffer();

  let decoded: AudioBuffer;
  try {
    // decodeAudioData consomme l'ArrayBuffer : il ne sera pas réutilisable.
    decoded = await decodingContext().decodeAudioData(bytes);
  } catch {
    throw new DecodeError(
      'unsupported',
      'Format non reconnu par ce navigateur. Essayez WAV, MP3, M4A ou FLAC.',
    );
  }

  const originalDurationS = decoded.duration;
  const truncated = originalDurationS > MAX_DURATION_S;
  const durationS = Math.min(originalDurationS, MAX_DURATION_S);
  const length = Math.max(1, Math.round(durationS * SAMPLE_RATE));

  // Un contexte hors-ligne mono à 48 kHz fait les deux d'un coup : mixage vers
  // le mono (moyenne des canaux) et rééchantillonnage.
  const renderer = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const source = renderer.createBufferSource();
  source.buffer = decoded;
  source.connect(renderer.destination);
  source.start(0, 0, durationS);
  const rendered = await renderer.startRendering();

  const samples = new Float32Array(rendered.length);
  rendered.copyFromChannel(samples, 0);

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  if (peak < 1e-5) {
    throw new DecodeError('silent', 'Ce fichier est silencieux — rien à débruiter.');
  }

  return {
    samples,
    sampleRate: SAMPLE_RATE,
    durationS: samples.length / SAMPLE_RATE,
    originalDurationS,
    truncated,
    name,
    bytes: file.size,
  };
}

/** Récupère un échantillon de démo servi avec le site (même chemin, même origine). */
export async function decodeUrl(url: string, name: string): Promise<DecodedAudio> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new DecodeError('unsupported', `Extrait indisponible (${response.status}).`);
  }
  return decodeFile(await response.blob(), name);
}
