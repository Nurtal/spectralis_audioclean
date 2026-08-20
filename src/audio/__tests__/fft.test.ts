import { describe, it, expect } from 'vitest';
import { FFT, getFFT, RealFFT, getRealFFT } from '../analysis/fft';

/** DFT naïve O(n²) : la référence, lente mais indiscutable. */
function naiveDft(re: Float32Array, im: Float32Array): { re: Float64Array; im: Float64Array } {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      sr += re[t] * c - im[t] * s;
      si += re[t] * s + im[t] * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}

describe('FFT', () => {
  it('refuse une taille qui n’est pas une puissance de deux', () => {
    expect(() => new FFT(100)).toThrow();
    expect(() => new FFT(1)).toThrow();
  });

  it('donne le même résultat qu’une DFT naïve', () => {
    const n = 256;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    let seed = 12345;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      re[i] = (seed / 0x7fffffff) * 2 - 1;
    }

    const expected = naiveDft(re, im);
    const fft = new FFT(n);
    fft.transform(re, im);

    let maxError = 0;
    for (let k = 0; k < n; k++) {
      maxError = Math.max(maxError, Math.abs(re[k] - expected.re[k]));
      maxError = Math.max(maxError, Math.abs(im[k] - expected.im[k]));
    }
    // Float32 sur 256 points : l'erreur d'accumulation reste très en dessous.
    expect(maxError).toBeLessThan(1e-3);
  });

  it('place une sinusoïde pure dans le bon bin', () => {
    const n = 1024;
    const bin = 64;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n);

    const fft = getFFT(n);
    fft.transform(re, im);
    const mag = new Float32Array(n / 2 + 1);
    fft.magnitudes(re, im, mag);

    let argmax = 0;
    for (let k = 1; k < mag.length; k++) if (mag[k] > mag[argmax]) argmax = k;
    expect(argmax).toBe(bin);
    // Une cosinusoïde d'amplitude 1 donne n/2 dans son bin.
    expect(mag[bin]).toBeCloseTo(n / 2, 0);
  });

  it('revient au signal de départ après aller-retour', () => {
    const n = 512;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    const original = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      original[i] = Math.sin(i * 0.1) * 0.5 + Math.sin(i * 0.37) * 0.25;
      re[i] = original[i];
    }

    const fft = getFFT(n);
    fft.transform(re, im);
    fft.inverse(re, im);

    for (let i = 0; i < n; i++) {
      expect(re[i]).toBeCloseTo(original[i], 4);
      expect(im[i]).toBeCloseTo(0, 4);
    }
  });

  it('réutilise l’instance mise en cache', () => {
    expect(getFFT(2048)).toBe(getFFT(2048));
  });
});

describe('RealFFT', () => {
  const sizes = [16, 256, 2048];

  function noisySignal(n: number, seed = 4242): Float32Array {
    const x = new Float32Array(n);
    let s = seed;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      x[i] = (s / 0x7fffffff) * 2 - 1;
    }
    return x;
  }

  it.each(sizes)('donne le même spectre que le chemin complexe (n = %i)', (n) => {
    const signal = noisySignal(n);

    const re = Float32Array.from(signal);
    const im = new Float32Array(n);
    getFFT(n).transform(re, im);

    const rfft = getRealFFT(n);
    const outRe = new Float32Array(rfft.bins);
    const outIm = new Float32Array(rfft.bins);
    rfft.forward(signal, outRe, outIm);

    for (let k = 0; k < rfft.bins; k++) {
      expect(outRe[k]).toBeCloseTo(re[k], 2);
      expect(outIm[k]).toBeCloseTo(im[k], 2);
    }
  });

  it.each(sizes)('revient au signal de départ (n = %i)', (n) => {
    const signal = noisySignal(n, 777);
    const rfft = getRealFFT(n);
    const outRe = new Float32Array(rfft.bins);
    const outIm = new Float32Array(rfft.bins);
    const back = new Float32Array(n);

    rfft.forward(signal, outRe, outIm);
    rfft.inverse(outRe, outIm, back);

    for (let i = 0; i < n; i++) expect(back[i]).toBeCloseTo(signal[i], 4);
  });

  it('place une sinusoïde dans le bon bin, à la bonne amplitude', () => {
    const n = 1024;
    const bin = 100;
    const signal = new Float32Array(n);
    for (let i = 0; i < n; i++) signal[i] = Math.cos((2 * Math.PI * bin * i) / n);

    const rfft = getRealFFT(n);
    const re = new Float32Array(rfft.bins);
    const im = new Float32Array(rfft.bins);
    const mag = new Float32Array(rfft.bins);
    rfft.forward(signal, re, im);
    rfft.magnitudes(re, im, mag);

    let argmax = 0;
    for (let k = 1; k < mag.length; k++) if (mag[k] > mag[argmax]) argmax = k;
    expect(argmax).toBe(bin);
    expect(mag[bin]).toBeCloseTo(n / 2, 0);
  });

  it('traite correctement le continu et la fréquence de Nyquist', () => {
    const n = 64;
    const rfft = getRealFFT(n);
    const re = new Float32Array(rfft.bins);
    const im = new Float32Array(rfft.bins);

    const dc = new Float32Array(n).fill(0.25);
    rfft.forward(dc, re, im);
    expect(re[0]).toBeCloseTo(0.25 * n, 3);
    expect(re[n / 2]).toBeCloseTo(0, 3);

    const nyquist = new Float32Array(n);
    for (let i = 0; i < n; i++) nyquist[i] = i % 2 === 0 ? 1 : -1;
    rfft.forward(nyquist, re, im);
    expect(re[n / 2]).toBeCloseTo(n, 3);
    expect(re[0]).toBeCloseTo(0, 3);
  });

  it('refuse une taille invalide', () => {
    expect(() => new RealFFT(6)).toThrow();
    expect(() => new RealFFT(2)).toThrow();
  });
});
