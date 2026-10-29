import { fft2d, nextPow2 } from "./fft";
import { otf } from "./psf";
import type { PsfModel } from "./types";

export interface DeconvOptions {
  model: PsfModel;
  /** PSF sigma in pixels (disk radius = 2·sigma). */
  sigma: number;
  /** Noise standard deviation (0..1 luminance scale). Drives regularization. */
  noise: number;
  /** Multiplier on the regularization weight. < 1 = more aggressive inverse (extreme mode). */
  lambdaScale?: number;
}

/** Regularization weight; grows with noise so noisy images get a gentler inverse. */
export function regularization(noise: number): number {
  const s = 0.006 + 1.5 * noise;
  return s * s;
}

/** Overlap needed so circular-convolution wrap and tile seams fall outside the kept core. */
export function deconvOverlap(model: PsfModel, sigma: number): number {
  const support = model === "disk" ? 7 * sigma : 6 * sigma;
  return Math.ceil(Math.max(16, support + 8));
}

/**
 * Frequency response of a regularized Wiener / constrained-least-squares inverse filter:
 *   W = H / (H² + λ·(1 + |L|²))
 * where L is the discrete Laplacian. The (1 + |L|²) term caps gain at mid frequencies
 * and penalises high-frequency noise, which limits ringing and noise blow-up. W(0) = 1,
 * so local mean brightness is preserved exactly.
 */
export function buildWienerFilter(n: number, model: PsfModel, sigma: number, lambda: number): Float32Array {
  const filter = new Float32Array(n * n);
  for (let v = 0; v < n; v++) {
    const fy = (v <= n / 2 ? v : v - n) / n;
    const sy = Math.sin(Math.PI * fy);
    for (let u = 0; u < n; u++) {
      const fx = (u <= n / 2 ? u : u - n) / n;
      const sx = Math.sin(Math.PI * fx);
      const lap = 4 * sx * sx + 4 * sy * sy;
      const H = otf(model, sigma, fx, fy);
      filter[v * n + u] = H / (H * H + lambda * (1 + lap * lap));
    }
  }
  return filter;
}

function reflect(i: number, n: number): number {
  if (n === 1) return 0;
  while (i < 0 || i >= n) {
    if (i < 0) i = -i;
    if (i >= n) i = 2 * n - 2 - i;
  }
  return i;
}

/**
 * Non-blind deconvolution of a luminance plane with a known PSF.
 * Processes overlapping power-of-two tiles so memory stays bounded for large regions;
 * each tile keeps only its core, discarding the overlap where wrap-around ringing lives.
 */
export function deconvolve(y: Float32Array, w: number, h: number, opts: DeconvOptions): Float32Array {
  if (opts.sigma < 0.15 || w < 2 || h < 2) return y.slice();
  const ov = deconvOverlap(opts.model, opts.sigma);
  const minN = nextPow2(2 * ov + 32);
  let n = nextPow2(Math.max(w, h) + 2 * ov);
  n = Math.min(n, Math.max(512, minN));
  n = Math.max(n, 64);
  const core = n - 2 * ov;
  const filter = buildWienerFilter(n, opts.model, opts.sigma, regularization(opts.noise) * (opts.lambdaScale ?? 1));
  const re = new Float32Array(n * n);
  const im = new Float32Array(n * n);
  const out = new Float32Array(w * h);

  for (let ty = 0; ty < h; ty += core) {
    for (let tx = 0; tx < w; tx += core) {
      let mean = 0;
      for (let j = 0; j < n; j++) {
        const sy = reflect(ty - ov + j, h) * w;
        const row = j * n;
        for (let i = 0; i < n; i++) {
          const v = y[sy + reflect(tx - ov + i, w)];
          re[row + i] = v;
          mean += v;
        }
      }
      mean /= n * n;
      for (let k = 0; k < re.length; k++) re[k] -= mean;
      im.fill(0);
      fft2d(re, im, n, n, false);
      for (let k = 0; k < re.length; k++) {
        re[k] *= filter[k];
        im[k] *= filter[k];
      }
      fft2d(re, im, n, n, true);
      const ch = Math.min(core, h - ty);
      const cw = Math.min(core, w - tx);
      for (let j = 0; j < ch; j++) {
        const src = (j + ov) * n + ov;
        const dst = (ty + j) * w + tx;
        for (let i = 0; i < cw; i++) out[dst + i] = re[src + i] + mean;
      }
    }
  }
  return out;
}
