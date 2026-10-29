import { gaussianBlur } from "./filters";
import { guidedFilter } from "./guided";
import type { Rect } from "./types";

/** Bounding box of mask pixels with value ≥ threshold, or null if none. */
export function maskBounds(mask: Uint8Array, w: number, h: number, threshold = 1): Rect | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let rowHit = false;
    for (let x = 0; x < w; x++) {
      if (mask[row + x] >= threshold) {
        rowHit = true;
        if (x < x0) x0 = x;
        break;
      }
    }
    if (!rowHit) continue;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[row + x] >= threshold) {
        if (x > x1) x1 = x;
        break;
      }
    }
    if (y < y0) y0 = y;
    y1 = y;
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

export function expandRect(r: Rect, pad: number, w: number, h: number): Rect {
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  const x2 = Math.min(w, r.x + r.width + pad);
  const y2 = Math.min(h, r.y + r.height + pad);
  return { x, y, width: x2 - x, height: y2 - y };
}

/**
 * Turns a hard user/auto mask into a soft blend alpha:
 * Gaussian feather, then a guided filter that snaps the soft edge to real image edges
 * (so the transition follows the subject's silhouette instead of the brush outline).
 * Values below 1/255 become exactly 0 so untouched pixels stay bit-identical.
 */
export function buildAlpha(mask: Uint8Array, guide: Float32Array, w: number, h: number, feather: number): Float32Array {
  const m = new Float32Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = mask[i] / 255;
  if (feather <= 0) return m;
  const soft = gaussianBlur(m, w, h, feather * 0.5);
  const refined = guidedFilter(guide, soft, w, h, Math.max(2, Math.round(feather * 0.75)), 2e-3);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) {
    let a = 0.5 * soft[i] + 0.5 * refined[i];
    if (a < 1 / 255) a = 0;
    else if (a > 254 / 255) a = 1;
    out[i] = a;
  }
  return out;
}
