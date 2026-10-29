/**
 * Separable image filters on single-channel Float32 planes (clamp-to-edge borders).
 */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Rec.601 luma in gamma space, scaled to 0..1. */
export function luminance(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = (0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) / 255;
  }
  return out;
}

function boxPassH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = (r + 1) * src[row];
    for (let k = 1; k <= r; k++) acc += src[row + Math.min(k, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * inv;
      acc += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
}

function boxPassV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  const acc = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let a = (r + 1) * src[x];
    for (let k = 1; k <= r; k++) a += src[Math.min(k, h - 1) * w + x];
    acc[x] = a;
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const addRow = Math.min(y + r + 1, h - 1) * w;
    const subRow = Math.max(y - r, 0) * w;
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc[x] * inv;
      acc[x] += src[addRow + x] - src[subRow + x];
    }
  }
}

/** Mean filter over a (2r+1)² window. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  r = Math.floor(r);
  if (r <= 0) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  boxPassH(src, tmp, w, h, r);
  boxPassV(tmp, out, w, h, r);
  return out;
}

/** Box radii whose 3-pass cascade approximates a Gaussian of the given sigma. */
export function boxRadiiForGaussian(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const radii: number[] = [];
  for (let i = 0; i < n; i++) radii.push(((i < m ? wl : wu) - 1) / 2);
  return radii;
}

export function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

function convolveSeparable(src: Float32Array, w: number, h: number, kernel: Float32Array): Float32Array {
  const r = (kernel.length - 1) >> 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      if (x >= r && x < w - r) {
        const base = row + x - r;
        for (let k = 0; k < kernel.length; k++) s += kernel[k] * src[base + k];
      } else {
        for (let k = -r; k <= r; k++) s += kernel[k + r] * src[row + clamp(x + k, 0, w - 1)];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const interior = y >= r && y < h - r;
    for (let x = 0; x < w; x++) {
      let s = 0;
      if (interior) {
        let idx = (y - r) * w + x;
        for (let k = 0; k < kernel.length; k++, idx += w) s += kernel[k] * tmp[idx];
      } else {
        for (let k = -r; k <= r; k++) s += kernel[k + r] * tmp[clamp(y + k, 0, h - 1) * w + x];
      }
      out[row + x] = s;
    }
  }
  return out;
}

/** Gaussian blur. Exact kernel for small sigma, 3-pass box cascade for large sigma. */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0.05) return src.slice();
  if (sigma < 2.5) return convolveSeparable(src, w, h, gaussianKernel(sigma));
  let cur = src;
  for (const r of boxRadiiForGaussian(sigma)) cur = boxBlur(cur, w, h, r);
  return cur === src ? src.slice() : cur;
}

/** 1D van Herk / Gil-Werman running min or max, O(1) per sample. */
function runningExtreme1D(
  line: Float32Array,
  n: number,
  r: number,
  out: Float32Array,
  isMax: boolean,
  p: Float32Array,
  g: Float32Array,
  hh: Float32Array,
): void {
  const k = 2 * r + 1;
  const m = n + 2 * r;
  for (let i = 0; i < m; i++) p[i] = line[clamp(i - r, 0, n - 1)];
  for (let b = 0; b < m; b += k) {
    const end = Math.min(b + k, m);
    g[b] = p[b];
    for (let i = b + 1; i < end; i++) g[i] = isMax ? Math.max(g[i - 1], p[i]) : Math.min(g[i - 1], p[i]);
    hh[end - 1] = p[end - 1];
    for (let i = end - 2; i >= b; i--) hh[i] = isMax ? Math.max(hh[i + 1], p[i]) : Math.min(hh[i + 1], p[i]);
  }
  for (let i = 0; i < n; i++) {
    const a = hh[i];
    const c = g[i + k - 1];
    out[i] = isMax ? Math.max(a, c) : Math.min(a, c);
  }
}

function extremeFilter(src: Float32Array, w: number, h: number, r: number, isMax: boolean): Float32Array {
  r = Math.floor(r);
  if (r <= 0) return src.slice();
  const maxLen = Math.max(w, h) + 2 * r;
  const p = new Float32Array(maxLen);
  const g = new Float32Array(maxLen);
  const hh = new Float32Array(maxLen);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const lineOut = new Float32Array(Math.max(w, h));
  for (let y = 0; y < h; y++) {
    runningExtreme1D(src.subarray(y * w, y * w + w), w, r, lineOut, isMax, p, g, hh);
    tmp.set(lineOut.subarray(0, w), y * w);
  }
  const col = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = tmp[y * w + x];
    runningExtreme1D(col, h, r, lineOut, isMax, p, g, hh);
    for (let y = 0; y < h; y++) out[y * w + x] = lineOut[y];
  }
  return out;
}

/** Minimum over a (2r+1)² square window. */
export function minFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  return extremeFilter(src, w, h, r, false);
}

/** Maximum over a (2r+1)² square window. */
export function maxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  return extremeFilter(src, w, h, r, true);
}

/** Central-difference gradients (zero at the 1px border). */
export function gradients(src: Float32Array, w: number, h: number): { gx: Float32Array; gy: Float32Array; mag: Float32Array } {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const dx = (src[i + 1] - src[i - 1]) * 0.5;
      const dy = (src[i + w] - src[i - w]) * 0.5;
      gx[i] = dx;
      gy[i] = dy;
      mag[i] = Math.sqrt(dx * dx + dy * dy);
    }
  }
  return { gx, gy, mag };
}

/** Value at the given quantile (0..1) of a sample of `src`. */
export function quantile(src: Float32Array, q: number, maxSamples = 200_000): number {
  if (src.length === 0) return 0;
  const step = Math.max(1, Math.floor(src.length / maxSamples));
  const sample = new Float32Array(Math.ceil(src.length / step));
  let n = 0;
  for (let i = 0; i < src.length; i += step) sample[n++] = src[i];
  const s = sample.subarray(0, n).sort();
  return s[clamp(Math.round(q * (n - 1)), 0, n - 1)];
}
