/**
 * FFT radix-2 Cooley-Tukey, en place, sans allocation par appel.
 *
 * Une instance = une taille. Les tables de rotation et la permutation binaire
 * sont calculées une fois à la construction ; `transform` ne fait qu'écrire
 * dans les tableaux qu'on lui passe. C'est la contrainte qui compte ici : une
 * allocation par trame et le GC mange tout le budget sur un fichier de 90 s.
 */
export class FFT {
  readonly size: number;
  private readonly levels: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT : taille ${size} non puissance de deux`);
    }
    this.size = size;
    this.levels = Math.log2(size) | 0;

    const half = size >> 1;
    this.cosTable = new Float32Array(half);
    this.sinTable = new Float32Array(half);
    for (let i = 0; i < half; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }

    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < this.levels; b++) {
        r = (r << 1) | ((i >>> b) & 1);
      }
      this.reverse[i] = r;
    }
  }

  /** Transformée directe, en place. `re` et `im` font `size` échantillons. */
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.size;
    if (re.length < n || im.length < n) {
      throw new Error('FFT : tableaux trop courts');
    }

    // Permutation à inversion de bits.
    const rev = this.reverse;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }

    const cos = this.cosTable;
    const sin = this.sinTable;
    for (let span = 2; span <= n; span <<= 1) {
      const halfSpan = span >> 1;
      const step = n / span;
      for (let start = 0; start < n; start += span) {
        for (let k = 0, tw = 0; k < halfSpan; k++, tw += step) {
          const a = start + k;
          const b = a + halfSpan;
          const wr = cos[tw];
          const wi = sin[tw];
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }

  /** Transformée inverse, en place, normalisée par 1/N. */
  inverse(re: Float32Array, im: Float32Array): void {
    const n = this.size;
    // conj → FFT → conj → 1/N
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.transform(re, im);
    const inv = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= inv;
      im[i] = -im[i] * inv;
    }
  }

  /**
   * Magnitudes des `size/2 + 1` bins utiles, écrites dans `out`.
   * `out` doit être fourni par l'appelant : c'est tout l'intérêt.
   */
  magnitudes(re: Float32Array, im: Float32Array, out: Float32Array): void {
    const bins = (this.size >> 1) + 1;
    for (let i = 0; i < bins; i++) {
      const r = re[i];
      const m = im[i];
      out[i] = Math.sqrt(r * r + m * m);
    }
  }
}

const cache = new Map<number, FFT>();

/** FFT partagée par taille — les instances sont sans état entre les appels. */
export function getFFT(size: number): FFT {
  let f = cache.get(size);
  if (!f) {
    f = new FFT(size);
    cache.set(size, f);
  }
  return f;
}

/**
 * FFT à entrée réelle.
 *
 * Un signal audio est réel : son spectre est symétrique, et la moitié du
 * travail d'une FFT complexe consiste à recalculer ce qu'on sait déjà. On
 * replie donc les N échantillons en N/2 complexes (pairs en partie réelle,
 * impairs en partie imaginaire), une FFT de taille N/2, puis un dépliage.
 *
 * Deux fois moins d'opérations, pour un résultat identique au bit près près —
 * c'est ce que vérifie `fft.test.ts`, contre le chemin complexe.
 */
export class RealFFT {
  readonly size: number;
  readonly bins: number;
  private readonly half: FFT;
  private readonly halfSize: number;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly workRe: Float32Array;
  private readonly workIm: Float32Array;

  constructor(size: number) {
    if (size < 4 || (size & (size - 1)) !== 0) {
      throw new Error(`RealFFT : taille ${size} invalide`);
    }
    this.size = size;
    this.halfSize = size >> 1;
    this.bins = this.halfSize + 1;
    this.half = getFFT(this.halfSize);
    this.workRe = new Float32Array(this.halfSize);
    this.workIm = new Float32Array(this.halfSize);

    this.cos = new Float32Array(this.halfSize);
    this.sin = new Float32Array(this.halfSize);
    for (let k = 0; k < this.halfSize; k++) {
      const angle = (-2 * Math.PI * k) / size;
      this.cos[k] = Math.cos(angle);
      this.sin[k] = Math.sin(angle);
    }
  }

  /**
   * `input` : `size` échantillons réels.
   * `outRe` / `outIm` : `size/2 + 1` bins.
   */
  forward(input: Float32Array, outRe: Float32Array, outIm: Float32Array): void {
    const m = this.halfSize;
    const zr = this.workRe;
    const zi = this.workIm;
    for (let k = 0; k < m; k++) {
      zr[k] = input[2 * k];
      zi[k] = input[2 * k + 1];
    }
    this.half.transform(zr, zi);

    // Bins extrêmes : tous deux réels.
    outRe[0] = zr[0] + zi[0];
    outIm[0] = 0;
    outRe[m] = zr[0] - zi[0];
    outIm[m] = 0;

    for (let k = 1; k <= m >> 1; k++) {
      const j = m - k;
      // Parties paire et impaire, extraites par symétrie hermitienne.
      const er = 0.5 * (zr[k] + zr[j]);
      const ei = 0.5 * (zi[k] - zi[j]);
      const or_ = 0.5 * (zi[k] + zi[j]);
      const oi = 0.5 * (zr[j] - zr[k]);

      const wr = this.cos[k];
      const wi = this.sin[k];
      const tr = or_ * wr - oi * wi;
      const ti = or_ * wi + oi * wr;

      outRe[k] = er + tr;
      outIm[k] = ei + ti;
      // Le bin miroir se déduit sans calcul supplémentaire.
      outRe[j] = er - tr;
      outIm[j] = -(ei - ti);
    }
  }

  /**
   * Reconstruction : `size/2 + 1` bins → `size` échantillons réels.
   * `inRe` / `inIm` ne sont pas modifiés.
   */
  inverse(inRe: Float32Array, inIm: Float32Array, output: Float32Array): void {
    const m = this.halfSize;
    const zr = this.workRe;
    const zi = this.workIm;

    for (let k = 0; k < m; k++) {
      const j = m - k;
      const xr = inRe[k];
      const xi = inIm[k];
      // Conjugué du bin miroir ; pour k = 0 c'est le bin de Nyquist.
      const yr = k === 0 ? inRe[m] : inRe[j];
      const yi = k === 0 ? -inIm[m] : -inIm[j];

      const er = 0.5 * (xr + yr);
      const ei = 0.5 * (xi + yi);
      let or_ = 0.5 * (xr - yr);
      let oi = 0.5 * (xi - yi);

      // Rotation inverse : conjugué de la table directe.
      const wr = this.cos[k];
      const wi = -this.sin[k];
      const tr = or_ * wr - oi * wi;
      const ti = or_ * wi + oi * wr;
      or_ = tr;
      oi = ti;

      zr[k] = er - oi;
      zi[k] = ei + or_;
    }

    this.half.inverse(zr, zi);

    for (let k = 0; k < m; k++) {
      output[2 * k] = zr[k];
      output[2 * k + 1] = zi[k];
    }
  }

  /** Magnitudes des bins utiles, écrites dans `out`. */
  magnitudes(re: Float32Array, im: Float32Array, out: Float32Array): void {
    for (let i = 0; i < this.bins; i++) {
      const r = re[i];
      const m = im[i];
      out[i] = Math.sqrt(r * r + m * m);
    }
  }
}

const realCache = new Map<number, RealFFT>();

export function getRealFFT(size: number): RealFFT {
  let f = realCache.get(size);
  if (!f) {
    f = new RealFFT(size);
    realCache.set(size, f);
  }
  return f;
}
