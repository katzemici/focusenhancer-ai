import { boxBlur } from "./filters";

/**
 * Edge-preserving guided filter (He, Sun & Tang, 2010) with a single-channel guide.
 * Output follows the edges of `guide` while smoothing `p`.
 */
export function guidedFilter(
  guide: Float32Array,
  p: Float32Array,
  w: number,
  h: number,
  r: number,
  eps: number,
): Float32Array {
  const n = w * h;
  const ip = new Float32Array(n);
  const ii = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ip[i] = guide[i] * p[i];
    ii[i] = guide[i] * guide[i];
  }
  const meanI = boxBlur(guide, w, h, r);
  const meanP = boxBlur(p, w, h, r);
  const corrI = boxBlur(ii, w, h, r);
  const corrIP = boxBlur(ip, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = corrI[i] - meanI[i] * meanI[i];
    const cov = corrIP[i] - meanI[i] * meanP[i];
    a[i] = cov / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxBlur(a, w, h, r);
  const meanB = boxBlur(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = meanA[i] * guide[i] + meanB[i];
  return q;
}
