import { boxBlur } from "./filters";

/**
 * Robust noise estimate (Immerkær-style Laplacian-difference operator + MAD).
 * The operator cancels smooth structure, so the median absolute response
 * is dominated by sensor noise rather than edges.
 * Returns the noise standard deviation on the 0..1 luminance scale.
 */
export function estimateNoise(y: Float32Array, w: number, h: number, maxSamples = 250_000): number {
  if (w < 3 || h < 3) return 0;
  const total = (w - 2) * (h - 2);
  const step = Math.max(1, Math.floor(Math.sqrt(total / maxSamples)));
  const values: number[] = [];
  for (let r = 1; r < h - 1; r += step) {
    for (let c = 1; c < w - 1; c += step) {
      const i = r * w + c;
      const v =
        y[i - w - 1] - 2 * y[i - w] + y[i - w + 1] -
        2 * y[i - 1] + 4 * y[i] - 2 * y[i + 1] +
        y[i + w - 1] - 2 * y[i + w] + y[i + w + 1];
      values.push(Math.abs(v));
    }
  }
  if (values.length === 0) return 0;
  const arr = Float32Array.from(values).sort();
  const median = arr[arr.length >> 1];
  // ||M||₂ = 6 for the 3×3 operator; 0.6745 converts MAD to sigma.
  return median / (0.6745 * 6);
}

/** Local standard deviation map (useful for flatness/texture tests). */
export function localStd(y: Float32Array, w: number, h: number, r: number): Float32Array {
  const m = boxBlur(y, w, h, r);
  const sq = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) sq[i] = y[i] * y[i];
  const m2 = boxBlur(sq, w, h, r);
  const out = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = Math.sqrt(Math.max(0, m2[i] - m[i] * m[i]));
  return out;
}
