/**
 * Encodage WAV 16 bits PCM.
 *
 * Pas de MP3, pas d'AAC : encoder en lossy demanderait un encodeur WASM
 * supplémentaire, et le résultat d'un débruitage se juge sur un fichier non
 * dégradé. L'utilisateur récupère exactement ce qu'il a entendu.
 */

const HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Écrit l'en-tête RIFF/WAVE canonique dans les 44 premiers octets. */
export function writeWavHeader(
  view: DataView,
  sampleCount: number,
  sampleRate: number,
  channels = 1,
  bitsPerSample = 16,
): void {
  const bytesPerSample = bitsPerSample >> 3;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = sampleCount * blockAlign;

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // taille du bloc fmt
  view.setUint16(20, 1, true); // PCM entier
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // octets par seconde
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
}

/** Float32 [-1, 1] → WAV mono 16 bits, en un seul ArrayBuffer. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_BYTES + samples.length * 2);
  const view = new DataView(buffer);
  writeWavHeader(view, samples.length, sampleRate);

  let offset = HEADER_BYTES;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    // Clamp avant conversion : un échantillon à 1.0000001 repasserait négatif.
    const clamped = v > 1 ? 1 : v < -1 ? -1 : v;
    view.setInt16(offset, Math.round(clamped * 32767), true);
    offset += 2;
  }
  return buffer;
}

export function encodeWavBlob(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' });
}
