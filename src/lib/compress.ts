/**
 * Export compressor: format, quality, resize, and target-file-size search.
 * `searchQuality` is DOM-free so it can be unit-tested with a fake encoder.
 */

export type CompressFormat = "png" | "jpeg" | "webp";
export type CompressMode = "quality" | "target";

export interface CompressSettings {
  format: CompressFormat;
  mode: CompressMode;
  /** 1..100, used in "quality" mode for JPEG/WebP. */
  quality: number;
  /** Target size in bytes, used in "target" mode for JPEG/WebP. */
  targetBytes: number;
  /** Longest output edge in px; null keeps the full resolution. */
  maxEdge: number | null;
}

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  /** Quality actually used (0..1), null for PNG. */
  quality: number | null;
  /** False when even the lowest quality could not reach the target. */
  metTarget: boolean;
}

export const MIME: Record<CompressFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
export const MIN_QUALITY = 0.3;
export const MAX_QUALITY = 0.95;

/**
 * Binary search for the highest quality whose encoded size is ≤ target.
 * Assumes size grows with quality (true for JPEG/WebP encoders in practice).
 * Never returns a result above the target if any quality ≥ MIN_QUALITY fits.
 */
export async function searchQuality(
  encode: (q: number) => Promise<Blob>,
  targetBytes: number,
  iterations = 7,
): Promise<{ blob: Blob; quality: number; metTarget: boolean }> {
  const top = await encode(MAX_QUALITY);
  if (top.size <= targetBytes) return { blob: top, quality: MAX_QUALITY, metTarget: true };
  const bottom = await encode(MIN_QUALITY);
  if (bottom.size > targetBytes) return { blob: bottom, quality: MIN_QUALITY, metTarget: false };
  let lo = MIN_QUALITY;
  let hi = MAX_QUALITY;
  let best = { blob: bottom, quality: MIN_QUALITY };
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const b = await encode(mid);
    if (b.size <= targetBytes) {
      best = { blob: b, quality: mid };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return { ...best, metTarget: true };
}

export function outputSize(w: number, h: number, maxEdge: number | null): { width: number; height: number } {
  if (!maxEdge || Math.max(w, h) <= maxEdge) return { width: w, height: h };
  const s = maxEdge / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

function encodeCanvas(c: HTMLCanvasElement, mime: string, q?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), mime, q));
}

/**
 * Downscales with repeated halving before the final step so large reductions stay sharp
 * and alias-free (a single drawImage at < 0.5× drops samples).
 */
export function resizeCanvas(src: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  if (src.width === width && src.height === height) return src;
  let cur = src;
  while (cur.width / 2 >= width && cur.height / 2 >= height) {
    const half = document.createElement("canvas");
    half.width = Math.round(cur.width / 2);
    half.height = Math.round(cur.height / 2);
    const g = half.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const g = out.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(cur, 0, 0, width, height);
  return out;
}

export async function compressCanvas(full: HTMLCanvasElement, s: CompressSettings): Promise<CompressResult> {
  const { width, height } = outputSize(full.width, full.height, s.maxEdge);
  const c = resizeCanvas(full, width, height);
  const mime = MIME[s.format];
  if (s.format === "png") {
    return { blob: await encodeCanvas(c, mime), width, height, quality: null, metTarget: true };
  }
  if (s.mode === "quality") {
    const q = Math.min(1, Math.max(0.01, s.quality / 100));
    return { blob: await encodeCanvas(c, mime, q), width, height, quality: q, metTarget: true };
  }
  const r = await searchQuality((q) => encodeCanvas(c, mime, q), s.targetBytes);
  return { blob: r.blob, width, height, quality: r.quality, metTarget: r.metTarget };
}

/** Slider position 0..100 ↔ target bytes on a log scale from 50 KB to 20 MB. */
const T_MIN = 50 * 1024;
const T_MAX = 20 * 1024 * 1024;
export function targetFromSlider(v: number): number {
  return Math.round(T_MIN * Math.pow(T_MAX / T_MIN, v / 100));
}
export function sliderFromTarget(bytes: number): number {
  return (100 * Math.log(bytes / T_MIN)) / Math.log(T_MAX / T_MIN);
}
