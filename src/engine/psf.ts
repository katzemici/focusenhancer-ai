import { gaussianBlur, gradients } from "./filters";
import type { PsfModel } from "./types";

export const SIGMA_MIN = 0.3;
export const SIGMA_MAX = 12;

/** Bessel function of the first kind, order 1 (Numerical Recipes rational approximation). */
export function besselJ1(x: number): number {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const a1 =
      x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1 + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606)))));
    const a2 = 144725228442.0 + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
    return a1 / a2;
  }
  const z = 8 / ax;
  const y = z * z;
  const xx = ax - 2.356194491;
  const p1 = 1.0 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const p2 = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  const ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * p2);
  return x < 0 ? -ans : ans;
}

/**
 * Optical transfer function of the PSF at spatial frequency (fx, fy) in cycles/pixel.
 * Both models are real and symmetric. For the disk model, radius = 2·sigma, which
 * matches the per-axis variance of a uniform disk (R²/4 = σ²).
 */
export function otf(model: PsfModel, sigma: number, fx: number, fy: number): number {
  const f2 = fx * fx + fy * fy;
  if (model === "gaussian") return Math.exp(-2 * Math.PI * Math.PI * sigma * sigma * f2);
  const radius = 2 * sigma;
  const z = 2 * Math.PI * radius * Math.sqrt(f2);
  if (z < 1e-6) return 1;
  return (2 * besselJ1(z)) / z;
}

export interface BlurEstimate {
  sigma: number;
  /** 0..1, based on how many usable edges were found. */
  confidence: number;
  edgeCount: number;
}

interface EstimateOptions {
  /** Optional per-pixel weight 0..1 restricting which edges are used (e.g. the mask). */
  weight?: Float32Array | null;
  /** Noise sigma; used to reject edges that are indistinguishable from noise. */
  noise?: number;
}

/**
 * Blind PSF size estimation using the re-blur gradient-ratio method (Zhuo & Sim, 2011).
 * For an edge blurred by an unknown Gaussian σ, re-blurring with a known σ0 gives a
 * gradient-magnitude ratio R = sqrt(σ² + σ0²) / σ at the edge, so σ = σ0 / sqrt(R² − 1).
 * Estimates at non-maximum-suppressed edge pixels are combined with a weighted median.
 */
export function estimateBlurSigma(y: Float32Array, w: number, h: number, opts: EstimateOptions = {}): BlurEstimate {
  const noise = opts.noise ?? 0;
  const pass = (sigma0: number) => estimatePass(y, w, h, sigma0, noise, opts.weight ?? null);
  const first = pass(1);
  if (first.edgeCount < 12) return { sigma: 1.5, confidence: 0, edgeCount: first.edgeCount };
  // Refine with a re-blur scale matched to the blur: keeps R well away from 1 for large blurs.
  const second = pass(Math.min(6, Math.max(1, first.sigma)));
  const est = second.edgeCount >= 12 ? second : first;
  return {
    sigma: Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, est.sigma)),
    confidence: Math.min(1, est.edgeCount / 400),
    edgeCount: est.edgeCount,
  };
}

function estimatePass(
  y: Float32Array,
  w: number,
  h: number,
  sigma0: number,
  noise: number,
  weight: Float32Array | null,
): { sigma: number; edgeCount: number } {
  const g1 = gradients(y, w, h);
  const g2 = gradients(gaussianBlur(y, w, h, sigma0), w, h);
  const threshold = Math.max(0.004, 4 * noise);
  const sig: number[] = [];
  const wts: number[] = [];
  for (let r = 2; r < h - 2; r++) {
    for (let c = 2; c < w - 2; c++) {
      const i = r * w + c;
      const m = g1.mag[i];
      if (m < threshold) continue;
      const wt = weight ? weight[i] : 1;
      if (wt < 0.5) continue;
      // Non-maximum suppression along the quantized gradient direction.
      const ax = Math.abs(g1.gx[i]);
      const ay = Math.abs(g1.gy[i]);
      let off: number;
      if (ax > 2.414 * ay) off = 1;
      else if (ay > 2.414 * ax) off = w;
      else off = g1.gx[i] * g1.gy[i] > 0 ? w + 1 : w - 1;
      if (m < g1.mag[i - off] || m < g1.mag[i + off]) continue;
      const m2 = g2.mag[i];
      if (m2 <= 1e-6) continue;
      const ratio = m / m2;
      const s = ratio <= 1.0005 ? SIGMA_MAX : sigma0 / Math.sqrt(ratio * ratio - 1);
      sig.push(Math.min(SIGMA_MAX, s));
      wts.push(m * wt);
    }
  }
  if (sig.length === 0) return { sigma: 1.5, edgeCount: 0 };
  return { sigma: weightedMedian(sig, wts), edgeCount: sig.length };
}

export function weightedMedian(values: number[], weights: number[]): number {
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  let total = 0;
  for (const wv of weights) total += wv;
  let acc = 0;
  for (const i of idx) {
    acc += weights[i];
    if (acc >= total / 2) return values[i];
  }
  return values[idx[idx.length - 1]];
}
