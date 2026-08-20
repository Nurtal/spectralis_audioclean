import { describe, it, expect } from 'vitest';
import { encodeWav } from '../encode/wav';

function ascii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('encodeWav', () => {
  const sampleRate = 48_000;
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const buffer = encodeWav(samples, sampleRate);
  const view = new DataView(buffer);

  it('écrit un en-tête RIFF/WAVE relisible', () => {
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(ascii(view, 36, 4)).toBe('data');
  });

  it('déclare du PCM 16 bits mono à la bonne fréquence', () => {
    expect(view.getUint32(16, true)).toBe(16); // taille du bloc fmt
    expect(view.getUint16(20, true)).toBe(1); // PCM entier
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.getUint16(34, true)).toBe(16); // bits par échantillon
    expect(view.getUint16(32, true)).toBe(2); // alignement de bloc
    expect(view.getUint32(28, true)).toBe(sampleRate * 2); // octets/seconde
  });

  it('annonce des tailles cohérentes avec la charge utile', () => {
    const dataBytes = samples.length * 2;
    expect(view.getUint32(40, true)).toBe(dataBytes);
    expect(view.getUint32(4, true)).toBe(36 + dataBytes);
    expect(buffer.byteLength).toBe(44 + dataBytes);
  });

  it('convertit les échantillons sans dépassement', () => {
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 32767));
    // Math.round arrondit les demis vers +∞ : -16383.5 donne -16383, soit un
    // LSB d'écart avec le positif. Inaudible, et le clamp reste correct.
    expect(view.getInt16(48, true)).toBe(-16383);
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32767);
  });

  it('borne les valeurs hors plage plutôt que de les faire déborder', () => {
    const clipped = new DataView(encodeWav(new Float32Array([1.5, -1.5]), sampleRate));
    expect(clipped.getInt16(44, true)).toBe(32767);
    expect(clipped.getInt16(46, true)).toBe(-32767);
  });
});
