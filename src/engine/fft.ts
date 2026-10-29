/**
 * Iterative radix-2 complex FFT (in place, split real/imag arrays) and a 2D helper.
 */

export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export class FFT {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(n: number) {
    if (!isPow2(n)) throw new Error(`FFT size must be a power of two, got ${n}`);
    this.n = n;
    const bits = Math.round(Math.log2(n));
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    const half = n >> 1;
    this.cos = new Float64Array(Math.max(1, half));
    this.sin = new Float64Array(Math.max(1, half));
    for (let i = 0; i < half; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }

  /** In-place transform. Forward uses e^{-2πi kn/N}; inverse is scaled by 1/N. */
  transform(re: Float32Array, im: Float32Array, inverse: boolean): void {
    const n = this.n;
    const rev = this.rev;
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
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = sign * this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    if (inverse) {
      const s = 1 / n;
      for (let i = 0; i < n; i++) {
        re[i] *= s;
        im[i] *= s;
      }
    }
  }
}

const cache = new Map<number, FFT>();

export function getFFT(n: number): FFT {
  let f = cache.get(n);
  if (!f) {
    f = new FFT(n);
    cache.set(n, f);
  }
  return f;
}

/** In-place 2D FFT of a w×h complex field (both power-of-two). */
export function fft2d(re: Float32Array, im: Float32Array, w: number, h: number, inverse: boolean): void {
  const fw = getFFT(w);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    fw.transform(re.subarray(o, o + w), im.subarray(o, o + w), inverse);
  }
  const fh = getFFT(h);
  const cr = new Float32Array(h);
  const ci = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      cr[y] = re[y * w + x];
      ci[y] = im[y * w + x];
    }
    fh.transform(cr, ci, inverse);
    for (let y = 0; y < h; y++) {
      re[y * w + x] = cr[y];
      im[y * w + x] = ci[y];
    }
  }
}
