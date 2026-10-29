import { boxBlur, clamp, gaussianBlur, gradients, maxFilter, minFilter, quantile } from "./filters";
import { maskBounds } from "./mask";
import type { DetectMode, DetectResult, RGBAImage } from "./types";

const WORK_SIZE = 256;

interface Planes {
  w: number;
  h: number;
  l: Float32Array;
  a: Float32Array;
  b: Float32Array;
}

/** Area-average downscale into luminance + two opponent-colour planes. */
function downscale(img: RGBAImage, maxSide: number): Planes {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  const n = w * h;
  const sr = new Float64Array(n);
  const sg = new Float64Array(n);
  const sb = new Float64Array(n);
  const cnt = new Float64Array(n);
  const d = img.data;
  const xMap = new Int32Array(img.width);
  for (let x = 0; x < img.width; x++) xMap[x] = Math.min(w - 1, Math.floor((x * w) / img.width));
  for (let y = 0; y < img.height; y++) {
    const ty = Math.min(h - 1, Math.floor((y * h) / img.height)) * w;
    let j = y * img.width * 4;
    for (let x = 0; x < img.width; x++, j += 4) {
      const t = ty + xMap[x];
      sr[t] += d[j];
      sg[t] += d[j + 1];
      sb[t] += d[j + 2];
      cnt[t] += 1;
    }
  }
  const l = new Float32Array(n);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = cnt[i] || 1;
    const r = sr[i] / c / 255;
    const g = sg[i] / c / 255;
    const bl = sb[i] / c / 255;
    l[i] = 0.299 * r + 0.587 * g + 0.114 * bl;
    a[i] = r - g;
    b[i] = 0.5 * (r + g) - bl;
  }
  return { w, h, l, a, b };
}

function normalize(src: Float32Array, hiQ = 0.99): Float32Array {
  const lo = quantile(src, 0.01);
  const hi = quantile(src, hiQ);
  const out = new Float32Array(src.length);
  const range = hi - lo;
  if (range <= 1e-9) return out;
  for (let i = 0; i < src.length; i++) out[i] = clamp((src[i] - lo) / range, 0, 1);
  return out;
}

/** Frequency-tuned saliency (Achanta et al., 2009): distance of blurred colour from the image mean. */
function frequencyTunedSaliency(p: Planes): Float32Array {
  const n = p.w * p.h;
  const planes = [p.l, p.a, p.b].map((c) => gaussianBlur(c, p.w, p.h, 1.2));
  const means = [p.l, p.a, p.b].map((c) => c.reduce((s, v) => s + v, 0) / n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < 3; k++) {
      const d = planes[k][i] - means[k];
      s += d * d;
    }
    out[i] = Math.sqrt(s);
  }
  return out;
}

/**
 * Centre-surround colour contrast: |G(σc) − G(σs)| summed over L/a/b. Responds to
 * compact regions that differ from their surroundings, independent of global statistics.
 */
function centerSurroundContrast(p: Planes): Float32Array {
  const n = p.w * p.h;
  const sc = Math.max(1.5, Math.min(p.w, p.h) / 80);
  const ss = Math.max(8, Math.min(p.w, p.h) / 8);
  const out = new Float32Array(n);
  for (const c of [p.l, p.a, p.b]) {
    const center = gaussianBlur(c, p.w, p.h, sc);
    const surround = gaussianBlur(c, p.w, p.h, ss);
    for (let i = 0; i < n; i++) {
      const d = center[i] - surround[i];
      out[i] += d * d;
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(out[i]);
  // Spread the (edge-heavy) response into region interiors.
  return gaussianBlur(out, p.w, p.h, ss * 0.5);
}

/** Local sharpness: RMS gradient in a small window, normalized to 0..1. */
function sharpnessMap(p: Planes): Float32Array {
  const { mag } = gradients(p.l, p.w, p.h);
  const e = new Float32Array(mag.length);
  for (let i = 0; i < mag.length; i++) e[i] = mag[i] * mag[i];
  const local = boxBlur(e, p.w, p.h, 3);
  for (let i = 0; i < local.length; i++) local[i] = Math.sqrt(local[i]);
  return normalize(local, 0.95);
}

export function otsuThreshold(v: Float32Array): number {
  const bins = 256;
  const hist = new Float64Array(bins);
  for (let i = 0; i < v.length; i++) hist[Math.min(bins - 1, Math.floor(clamp(v[i], 0, 1) * bins))]++;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 0.5;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = v.length - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = (i + 1) / bins;
    }
  }
  return thr;
}

/** Keeps the strongest connected component(s) by score mass and fills holes. */
function selectComponents(bin: Uint8Array, score: Float32Array, w: number, h: number): Uint8Array {
  const labels = new Int32Array(w * h).fill(-1);
  const mass: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || labels[start] >= 0) continue;
    const id = mass.length;
    let m = 0;
    stack.push(start);
    labels[start] = id;
    while (stack.length) {
      const i = stack.pop() as number;
      m += score[i];
      const x = i % w;
      const nbrs = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of nbrs) {
        if (j >= 0 && j < bin.length && bin[j] && labels[j] < 0) {
          labels[j] = id;
          stack.push(j);
        }
      }
    }
    mass.push(m);
  }
  const out = new Uint8Array(w * h);
  if (mass.length === 0) return out;
  const best = mass.reduce((m, v) => (v > m ? v : m), 0);
  const keep = mass.map((m) => m >= 0.3 * best);
  for (let i = 0; i < out.length; i++) if (labels[i] >= 0 && keep[labels[i]]) out[i] = 1;
  // Fill holes: flood the background from the border; anything unreached is interior.
  const outside = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    stack.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop() as number;
    if (outside[i] || out[i]) continue;
    outside[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i - w >= 0) stack.push(i - w);
    if (i + w < out.length) stack.push(i + w);
  }
  for (let i = 0; i < out.length; i++) if (!outside[i]) out[i] = 1;
  return out;
}

function centeredEllipse(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.28;
  const ry = h * 0.36;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) out[y * w + x] = 1;
    }
  return out;
}

/**
 * Lightweight subject detection: frequency-tuned saliency + centre-surround colour
 * contrast with a soft centre prior. In "soft-focus" mode the score is additionally
 * weighted towards regions with low local sharpness, so salient-but-blurry subjects win
 * over sharp backgrounds. Low-contrast images fall back to a centred ellipse.
 */
export function detectSubject(img: RGBAImage, mode: DetectMode): DetectResult {
  const p = downscale(img, WORK_SIZE);
  const { w, h } = p;
  const ftRaw = frequencyTunedSaliency(p);
  const csRaw = centerSurroundContrast(p);
  // Raw saliency is in 0..1 colour units; below ~2% there is nothing to segment.
  const lowContrast = quantile(ftRaw, 0.99) < 0.02 && quantile(csRaw, 0.99) < 0.02;
  const ft = normalize(ftRaw);
  const cs = normalize(csRaw);
  const score = new Float32Array(w * h);
  const sigX = 0.32 * w;
  const sigY = 0.36 * h;
  const sharp = mode === "soft-focus" ? sharpnessMap(p) : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = (x - w / 2) / sigX;
      const dy = (y - h / 2) / sigY;
      const center = Math.exp(-0.5 * (dx * dx + dy * dy));
      let s = (0.6 * ft[i] + 0.4 * cs[i]) * (0.5 + 0.5 * center);
      if (sharp) s *= 0.3 + 0.7 * (1 - sharp[i]);
      score[i] = s;
    }
  }
  const norm = normalize(gaussianBlur(score, w, h, 1.5));
  const thr = otsuThreshold(norm);
  let bin: Float32Array = new Float32Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = norm[i] > thr ? 1 : 0;
  // Morphological closing joins fragmented parts of one subject.
  bin = minFilter(maxFilter(bin, w, h, 2), w, h, 2);
  const binU8 = new Uint8Array(w * h);
  for (let i = 0; i < binU8.length; i++) binU8[i] = bin[i] > 0.5 ? 1 : 0;
  let small = selectComponents(binU8, norm, w, h);

  let area = 0;
  for (let i = 0; i < small.length; i++) area += small[i];
  let fallback = false;
  if (lowContrast || area < 0.005 * w * h || area > 0.9 * w * h) {
    small = centeredEllipse(w, h);
    fallback = true;
  }

  // Upsample with bilinear interpolation + 0.5 threshold for a smooth silhouette.
  const smallF = new Float32Array(small.length);
  for (let i = 0; i < small.length; i++) smallF[i] = small[i];
  const W = img.width;
  const H = img.height;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = clamp(((y + 0.5) * h) / H - 0.5, 0, h - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const wy = fy - y0;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const fx = clamp(((x + 0.5) * w) / W - 0.5, 0, w - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const wx = fx - x0;
      const v =
        (smallF[y0 * w + x0] * (1 - wx) + smallF[y0 * w + x1] * wx) * (1 - wy) +
        (smallF[y1 * w + x0] * (1 - wx) + smallF[y1 * w + x1] * wx) * wy;
      if (v >= 0.5) mask[row + x] = 255;
    }
  }
  let covered = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) covered++;
  return { mask, bbox: maskBounds(mask, W, H), coverage: covered / mask.length, fallback };
}


/** Exposed for unit tests and diagnostics only. */
export const _internal = { downscale, frequencyTunedSaliency, centerSurroundContrast, normalize };
