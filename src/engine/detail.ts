import { gaussianBlur, gradients, maxFilter, minFilter } from "./filters";

/**
 * Ringing / halo suppression: clamp the restored signal to the local value range of the
 * source (plus a small slack). Deconvolution may steepen an edge between existing levels,
 * but it may not create new extremes, which is the main source of halos and invented detail.
 */
export function suppressRinging(
  restored: Float32Array,
  source: Float32Array,
  w: number,
  h: number,
  radius: number,
  slack: number,
): Float32Array {
  const lo = minFilter(source, w, h, radius);
  const hi = maxFilter(source, w, h, radius);
  const out = new Float32Array(restored.length);
  for (let i = 0; i < out.length; i++) {
    const m = slack * (hi[i] - lo[i]) + 0.002;
    const a = lo[i] - m;
    const b = hi[i] + m;
    const v = restored[i];
    out[i] = v < a ? a : v > b ? b : v;
  }
  return out;
}

/**
 * Texture fidelity: replace the finest frequency band of the restored image with the
 * source's own fine band, weighted by `amount` (0..1). This keeps the real sensor grain
 * and skin texture instead of the smoothed or amplified version produced by the inverse
 * filter, so nothing is synthesized.
 */
export function transferGrain(
  restored: Float32Array,
  source: Float32Array,
  w: number,
  h: number,
  amount: number,
  sigma = 0.8,
): Float32Array {
  if (amount <= 0) return restored.slice();
  const sBase = gaussianBlur(source, w, h, sigma);
  const rBase = gaussianBlur(restored, w, h, sigma);
  const out = new Float32Array(restored.length);
  for (let i = 0; i < out.length; i++) {
    const sFine = source[i] - sBase[i];
    const rFine = restored[i] - rBase[i];
    out[i] = restored[i] + amount * (sFine - rFine);
  }
  return out;
}

/**
 * Clarity: soft-knee local contrast at a medium radius plus noise-gated fine edge
 * sharpening. The soft knee (d / (1 + k|d|)) prevents halos on strong edges; the gate
 * g = m² / (m² + (3σn)²) keeps flat, noisy areas from being sharpened.
 */
export function applyClarity(
  y: Float32Array,
  w: number,
  h: number,
  amount: number,
  noise: number,
  radius: number,
): Float32Array {
  if (amount <= 0) return y.slice();
  const base = gaussianBlur(y, w, h, radius);
  const fineBase = gaussianBlur(y, w, h, 1.0);
  const { mag } = gradients(y, w, h);
  const n2 = Math.max(1e-6, (3 * noise + 0.004) ** 2);
  const out = new Float32Array(y.length);
  const localGain = 0.9 * amount;
  const edgeGain = 1.1 * amount;
  for (let i = 0; i < out.length; i++) {
    const d = y[i] - base[i];
    const local = (localGain * d) / (1 + 5 * Math.abs(d));
    const f = y[i] - fineBase[i];
    const m2 = mag[i] * mag[i];
    const gate = m2 / (m2 + n2);
    const edge = (edgeGain * gate * f) / (1 + 10 * Math.abs(f));
    out[i] = y[i] + local + edge;
  }
  return out;
}


function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Per-pixel deblur weight (0..1) from local blur estimates. At each edge pixel the re-blur
 * gradient ratio gives a local σ (same method as the global PSF estimate). Edges that are
 * already sharper than ~half the correction σ get weight 0, so deconvolution does not ring
 * on in-focus detail that happens to be inside the mask. The edge-wise indicator is spread
 * into surrounding pixels with normalized (gradient-weighted) Gaussian convolution.
 */
export function blurAdaptiveWeight(y: Float32Array, w: number, h: number, sigma: number, noise: number): Float32Array {
  const s0 = Math.max(1, sigma);
  const g1 = gradients(y, w, h).mag;
  const g2 = gradients(gaussianBlur(y, w, h, s0), w, h).mag;
  const thr = Math.max(0.004, 4 * noise);
  const num = new Float32Array(y.length);
  const den = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) {
    const m = g1[i];
    if (m < thr || g2[i] <= 1e-6) continue;
    const r = m / g2[i];
    const local = r <= 1.0005 ? 1e3 : s0 / Math.sqrt(r * r - 1);
    num[i] = m * smoothstep(0.3 * sigma, 0.65 * sigma, local);
    den[i] = m;
  }
  const spread = 2 * sigma + 3;
  const n = gaussianBlur(num, w, h, spread);
  const d = gaussianBlur(den, w, h, spread);
  const out = new Float32Array(y.length);
  for (let i = 0; i < out.length; i++) out[i] = d[i] > 1e-5 ? n[i] / d[i] : 1;
  return out;
}

/** restored ← source + weight·(restored − source). */
export function blendByWeight(restored: Float32Array, source: Float32Array, weight: Float32Array): Float32Array {
  const out = new Float32Array(restored.length);
  for (let i = 0; i < out.length; i++) out[i] = source[i] + weight[i] * (restored[i] - source[i]);
  return out;
}
