import { describe, expect, it } from "vitest";
import { FFT, fft2d } from "./fft";
import { boxBlur, gaussianBlur, maxFilter, minFilter, quantile } from "./filters";
import { estimateNoise } from "./noise";
import { besselJ1, estimateBlurSigma, otf } from "./psf";
import { buildWienerFilter, deconvolve } from "./deconv";
import { guidedFilter } from "./guided";
import { blurAdaptiveWeight, suppressRinging, transferGrain } from "./detail";
import { buildAlpha, maskBounds } from "./mask";
import { EnhanceSession } from "./pipeline";
import { detectSubject } from "./detect";
import { DEFAULT_PARAMS, type RGBAImage } from "./types";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gaussRng(seed: number) {
  const u = rng(seed);
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** Random rectangles: lots of step edges at varied orientations/contrasts. */
function sharpScene(w: number, h: number, seed = 1): Float32Array {
  const r = rng(seed);
  const img = new Float32Array(w * h).fill(0.5);
  for (let k = 0; k < 40; k++) {
    const x0 = Math.floor(r() * w);
    const y0 = Math.floor(r() * h);
    const rw = 6 + Math.floor(r() * w * 0.3);
    const rh = 6 + Math.floor(r() * h * 0.3);
    const v = 0.15 + 0.7 * r();
    for (let y = y0; y < Math.min(h, y0 + rh); y++)
      for (let x = x0; x < Math.min(w, x0 + rw); x++) img[y * w + x] = v;
  }
  return img;
}

function rmse(a: Float32Array, b: Float32Array, w: number, h: number, border = 0): number {
  let s = 0;
  let n = 0;
  for (let y = border; y < h - border; y++)
    for (let x = border; x < w - border; x++) {
      const d = a[y * w + x] - b[y * w + x];
      s += d * d;
      n++;
    }
  return Math.sqrt(s / n);
}

function toRGBA(y: Float32Array, w: number, h: number, tint = [1, 1, 1]): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = y[i] * 255 * tint[0];
    data[i * 4 + 1] = y[i] * 255 * tint[1];
    data[i * 4 + 2] = y[i] * 255 * tint[2];
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

describe("fft", () => {
  it("matches a naive DFT and round-trips", () => {
    const n = 16;
    const r = rng(3);
    const re = new Float32Array(n).map(() => r());
    const im = new Float32Array(n).map(() => r());
    const xr = re.slice();
    const xi = im.slice();
    new FFT(n).transform(xr, xi, false);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        const a = (-2 * Math.PI * k * t) / n;
        sr += re[t] * Math.cos(a) - im[t] * Math.sin(a);
        si += re[t] * Math.sin(a) + im[t] * Math.cos(a);
      }
      expect(xr[k]).toBeCloseTo(sr, 4);
      expect(xi[k]).toBeCloseTo(si, 4);
    }
    new FFT(n).transform(xr, xi, true);
    for (let t = 0; t < n; t++) expect(xr[t]).toBeCloseTo(re[t], 5);
  });

  it("2D round-trips", () => {
    const w = 32;
    const h = 16;
    const src = sharpScene(w, h);
    const re = src.slice();
    const im = new Float32Array(w * h);
    fft2d(re, im, w, h, false);
    fft2d(re, im, w, h, true);
    expect(rmse(re, src, w, h)).toBeLessThan(1e-5);
  });

  it("rejects non power-of-two sizes", () => {
    expect(() => new FFT(12)).toThrow();
  });
});

describe("filters", () => {
  it("gaussianBlur preserves the mean and constant images", () => {
    const w = 64;
    const h = 48;
    const src = sharpScene(w, h);
    for (const s of [0.8, 2, 4]) {
      const out = gaussianBlur(src, w, h, s);
      const m0 = src.reduce((a, b) => a + b, 0) / src.length;
      const m1 = out.reduce((a, b) => a + b, 0) / out.length;
      expect(Math.abs(m0 - m1)).toBeLessThan(0.01);
    }
    const flat = new Float32Array(100).fill(0.3);
    const out = gaussianBlur(flat, 10, 10, 3);
    for (const v of out) expect(v).toBeCloseTo(0.3, 5);
  });

  it("boxBlur equals brute-force mean in the interior", () => {
    const w = 20;
    const h = 20;
    const src = sharpScene(w, h, 7);
    const out = boxBlur(src, w, h, 2);
    let s = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += src[(10 + dy) * w + 10 + dx];
    expect(out[10 * w + 10]).toBeCloseTo(s / 25, 5);
  });

  it("min/max filters match brute force", () => {
    const w = 23;
    const h = 17;
    const r0 = rng(9);
    const src = new Float32Array(w * h).map(() => r0());
    const r = 3;
    const mn = minFilter(src, w, h, r);
    const mx = maxFilter(src, w, h, r);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let a = Infinity;
        let b = -Infinity;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const v = src[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
            a = Math.min(a, v);
            b = Math.max(b, v);
          }
        expect(mn[y * w + x]).toBe(a);
        expect(mx[y * w + x]).toBe(b);
      }
  });

  it("quantile returns sensible values", () => {
    const v = Float32Array.from({ length: 101 }, (_, i) => i);
    expect(quantile(v, 0)).toBe(0);
    expect(quantile(v, 0.5)).toBe(50);
    expect(quantile(v, 1)).toBe(100);
  });
});

describe("noise", () => {
  it("estimates additive gaussian noise within 20%", () => {
    const w = 256;
    const h = 256;
    const base = gaussianBlur(sharpScene(w, h, 2), w, h, 1.5);
    for (const sigma of [0.01, 0.03]) {
      const g = gaussRng(5);
      const noisy = base.map((v) => v + sigma * g());
      const est = estimateNoise(noisy, w, h);
      expect(est).toBeGreaterThan(sigma * 0.8);
      expect(est).toBeLessThan(sigma * 1.25);
    }
  });

  it("is near zero on a clean smooth image", () => {
    const w = 128;
    const base = gaussianBlur(sharpScene(w, w, 4), w, w, 3);
    expect(estimateNoise(base, w, w)).toBeLessThan(0.003);
  });
});

describe("psf", () => {
  it("besselJ1 matches known values", () => {
    expect(besselJ1(0)).toBeCloseTo(0, 6);
    expect(besselJ1(1)).toBeCloseTo(0.4400505857, 6);
    expect(besselJ1(3.8317)).toBeCloseTo(0, 4);
    expect(besselJ1(10)).toBeCloseTo(0.0434727462, 5);
  });

  it("OTFs are 1 at DC and decay", () => {
    for (const m of ["gaussian", "disk"] as const) {
      expect(otf(m, 2, 0, 0)).toBeCloseTo(1, 6);
      expect(Math.abs(otf(m, 2, 0.25, 0))).toBeLessThan(0.3);
    }
  });

  it("recovers the gaussian blur sigma of a synthetic scene", () => {
    const w = 256;
    const h = 256;
    const sharp = sharpScene(w, h, 11);
    for (const s of [1.5, 3, 5]) {
      const blurred = gaussianBlur(sharp, w, h, s);
      const est = estimateBlurSigma(blurred, w, h);
      expect(est.confidence).toBeGreaterThan(0.5);
      expect(est.sigma).toBeGreaterThan(s * 0.7);
      expect(est.sigma).toBeLessThan(s * 1.35);
    }
  });

  it("returns low confidence on a flat image", () => {
    const est = estimateBlurSigma(new Float32Array(64 * 64).fill(0.5), 64, 64);
    expect(est.confidence).toBe(0);
  });
});

describe("deconvolution", () => {
  it("Wiener filter has unit DC gain", () => {
    const f = buildWienerFilter(64, "gaussian", 2, 1e-4);
    expect(f[0]).toBeCloseTo(1 / (1 + 1e-4), 4);
  });

  it("restores a gaussian-blurred image closer to the original", () => {
    const w = 200;
    const h = 160;
    const sharp = sharpScene(w, h, 21);
    const blurred = gaussianBlur(sharp, w, h, 2);
    const g = gaussRng(1);
    const noisy = blurred.map((v) => v + 0.003 * g());
    const restored = deconvolve(noisy, w, h, { model: "gaussian", sigma: 2, noise: 0.003 });
    const before = rmse(noisy, sharp, w, h, 4);
    const after = rmse(restored, sharp, w, h, 4);
    expect(after).toBeLessThan(before * 0.8);
  });

  it("is seamless across tiles (large image) and preserves flat regions", () => {
    const w = 900;
    const h = 300;
    const flat = new Float32Array(w * h).fill(0.42);
    const out = deconvolve(flat, w, h, { model: "disk", sigma: 2, noise: 0.002 });
    let maxErr = 0;
    for (const v of out) maxErr = Math.max(maxErr, Math.abs(v - 0.42));
    expect(maxErr).toBeLessThan(1e-4);
  });

  it("tiled output equals single-tile output in the interior", () => {
    const w = 700;
    const h = 120;
    const src = gaussianBlur(sharpScene(w, h, 5), w, h, 1.5);
    const a = deconvolve(src, w, h, { model: "gaussian", sigma: 1.5, noise: 0.002 });
    // A narrow crop fits in one tile; compare its interior against the tiled result.
    const cx = 300;
    const cw = 200;
    const crop = new Float32Array(cw * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = src[y * w + cx + x];
    const b = deconvolve(crop, cw, h, { model: "gaussian", sigma: 1.5, noise: 0.002 });
    let maxErr = 0;
    for (let y = 30; y < h - 30; y++)
      for (let x = 40; x < cw - 40; x++) maxErr = Math.max(maxErr, Math.abs(a[y * w + cx + x] - b[y * cw + x]));
    expect(maxErr).toBeLessThan(0.01);
  });
});

describe("detail and fidelity", () => {
  it("suppressRinging never exceeds local source range plus slack", () => {
    const w = 64;
    const src = gaussianBlur(sharpScene(w, w, 3), w, w, 2);
    const wild = src.map((v, i) => v + (i % 2 ? 0.5 : -0.5));
    const out = suppressRinging(wild, src, w, w, 3, 0);
    const lo = minFilter(src, w, w, 3);
    const hi = maxFilter(src, w, w, 3);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(lo[i] - 0.0021);
      expect(out[i]).toBeLessThanOrEqual(hi[i] + 0.0021);
    }
  });

  it("transferGrain at amount 1 restores the source fine band", () => {
    const w = 64;
    const g = gaussRng(2);
    const src = new Float32Array(w * w).map(() => 0.5 + 0.05 * g());
    const smooth = gaussianBlur(src, w, w, 2);
    const out = transferGrain(smooth, src, w, w, 1);
    const fineSrc = src.map((v, i) => v - gaussianBlur(src, w, w, 0.8)[i]);
    const outBase = gaussianBlur(out, w, w, 0.8);
    const fineOut = out.map((v, i) => v - outBase[i]);
    expect(rmse(fineOut, fineSrc, w, w, 3)).toBeLessThan(0.01);
  });

  it("blurAdaptiveWeight is ~0 on sharp edges and ~1 on blurred edges", () => {
    const w = 256;
    const h = 128;
    const sharp = sharpScene(w, h, 8);
    const half = gaussianBlur(sharp, w, h, 3);
    // Left half sharp, right half blurred with sigma 3.
    const mixed = sharp.map((v, i) => ((i % w) < w / 2 ? v : half[i]));
    const wt = blurAdaptiveWeight(mixed, w, h, 3, 0);
    let left = 0, right = 0, nl = 0, nr = 0;
    for (let y = 20; y < h - 20; y++)
      for (let x = 20; x < w - 20; x++) {
        if (x < w / 2 - 25) { left += wt[y * w + x]; nl++; }
        else if (x > w / 2 + 25) { right += wt[y * w + x]; nr++; }
      }
    expect(left / nl).toBeLessThan(0.25);
    expect(right / nr).toBeGreaterThan(0.75);
  });

  it("guidedFilter keeps a constant input constant", () => {
    const w = 32;
    const guide = sharpScene(w, w, 1);
    const p = new Float32Array(w * w).fill(0.7);
    const q = guidedFilter(guide, p, w, w, 4, 1e-3);
    for (const v of q) expect(v).toBeCloseTo(0.7, 4);
  });
});

describe("mask", () => {
  it("maskBounds finds the bounding box", () => {
    const w = 10;
    const m = new Uint8Array(100);
    m[3 * w + 2] = 255;
    m[6 * w + 7] = 255;
    expect(maskBounds(m, w, 10)).toEqual({ x: 2, y: 3, width: 6, height: 4 });
    expect(maskBounds(new Uint8Array(100), w, 10)).toBeNull();
  });

  it("buildAlpha is 0 far outside, 1 deep inside", () => {
    const w = 100;
    const m = new Uint8Array(w * w);
    for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) m[y * w + x] = 255;
    const a = buildAlpha(m, new Float32Array(w * w).fill(0.5), w, w, 8);
    expect(a[50 * w + 50]).toBe(1);
    expect(a[5 * w + 5]).toBe(0);
    expect(a[50 * w + 30]).toBeGreaterThan(0.2);
    expect(a[50 * w + 30]).toBeLessThan(0.8);
  });
});

describe("pipeline", () => {
  function setup(w = 320, h = 240) {
    const sharp = sharpScene(w, h, 33);
    const blurred = gaussianBlur(sharp, w, h, 2.2);
    const img = toRGBA(blurred, w, h, [1, 0.85, 0.7]);
    const mask = new Uint8Array(w * h);
    for (let y = 60; y < 180; y++) for (let x = 80; x < 240; x++) mask[y * w + x] = 255;
    const s = new EnhanceSession();
    s.setImage(img);
    s.setMask(mask, 1);
    return { s, img, sharp, mask, w, h };
  }

  it("leaves pixels outside the feathered mask bit-identical", () => {
    const { s, img, w } = setup();
    const out = s.run({ ...DEFAULT_PARAMS, deblur: 100, clarity: 80 });
    const { roi, patch } = out;
    let changedOutside = 0;
    for (let y = 0; y < roi.height; y++)
      for (let x = 0; x < roi.width; x++) {
        const gx = roi.x + x;
        const gy = roi.y + y;
        const far = gx < 80 - 40 || gx >= 240 + 40 || gy < 60 - 40 || gy >= 180 + 40;
        if (!far) continue;
        for (let c = 0; c < 4; c++) {
          if (patch[(y * roi.width + x) * 4 + c] !== img.data[(gy * w + gx) * 4 + c]) changedOutside++;
        }
      }
    expect(changedOutside).toBe(0);
  });

  it("is an identity at deblur 0 and clarity 0", () => {
    const { s, img, w } = setup();
    const out = s.run({ ...DEFAULT_PARAMS, deblur: 0, clarity: 0 });
    const { roi, patch } = out;
    for (let y = 0; y < roi.height; y += 7)
      for (let x = 0; x < roi.width; x += 7)
        for (let c = 0; c < 4; c++)
          expect(patch[(y * roi.width + x) * 4 + c]).toBe(img.data[((roi.y + y) * w + roi.x + x) * 4 + c]);
  });

  it("improves sharpness inside the mask, estimates sigma, preserves chroma and alpha", () => {
    const { s, img, sharp, w } = setup();
    const out = s.run({ ...DEFAULT_PARAMS, deblur: 100, fidelity: 30, clarity: 0 });
    expect(out.stats.sigma).toBeGreaterThan(1.4);
    expect(out.stats.sigma).toBeLessThan(3.2);
    const { roi, patch } = out;
    let errBefore = 0;
    let errAfter = 0;
    let chromaDrift = 0;
    let n = 0;
    for (let y = 80; y < 160; y++)
      for (let x = 100; x < 220; x++) {
        const pi = ((y - roi.y) * roi.width + (x - roi.x)) * 4;
        const oi = (y * w + x) * 4;
        const truth = sharp[y * w + x] * 255;
        errBefore += (img.data[oi] - truth) ** 2;
        errAfter += (patch[pi] - truth) ** 2;
        const pr = patch[pi];
        if (pr > 2 && pr < 253 && patch[pi + 2] > 2 && patch[pi + 2] < 253) {
          chromaDrift += Math.abs(patch[pi] - patch[pi + 2] - (img.data[oi] - img.data[oi + 2]));
          n++;
        }
        expect(patch[pi + 3]).toBe(255);
      }
    expect(errAfter).toBeLessThan(errBefore * 0.85);
    expect(chromaDrift / n).toBeLessThan(1.01);
  });

  it("reuses cached deconvolution when only fidelity changes", () => {
    const { s } = setup();
    s.run({ ...DEFAULT_PARAMS });
    const second = s.run({ ...DEFAULT_PARAMS, fidelity: 10 });
    expect(second.stats.timings.deconvolve).toBeLessThanOrEqual(5);
  });

  it("normal mode caps sliders at 100%; extreme mode at <=100% is identical to normal", () => {
    const { s } = setup();
    const a = s.run({ ...DEFAULT_PARAMS, deblur: 100, clarity: 100 }).patch;
    const b = s.run({ ...DEFAULT_PARAMS, deblur: 250, clarity: 250, extreme: false }).patch;
    const c = s.run({ ...DEFAULT_PARAMS, deblur: 100, clarity: 100, extreme: true }).patch;
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(c).equals(Buffer.from(a))).toBe(true);
  });

  it("extreme mode is much stronger but still leaves outside pixels untouched", () => {
    const { s, img, w } = setup();
    const lapEnergy = (d: Uint8ClampedArray, rw: number, x0: number, y0: number, x1: number, y1: number) => {
      let e = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * rw + x) * 4;
          const v = 4 * d[i] - d[i - 4] - d[i + 4] - d[i - rw * 4] - d[i + rw * 4];
          e += v * v;
        }
      return e;
    };
    const normal = s.run({ ...DEFAULT_PARAMS, deblur: 100, clarity: 100 });
    const extreme = s.run({ ...DEFAULT_PARAMS, deblur: 300, clarity: 300, extreme: true });
    const r = normal.roi;
    const box = [100 - r.x, 80 - r.y, 220 - r.x, 160 - r.y] as const;
    const eN = lapEnergy(normal.patch, r.width, ...box);
    const eX = lapEnergy(extreme.patch, r.width, ...box);
    expect(eX).toBeGreaterThan(eN * 1.5);
    let changed = 0;
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < r.width; x++) {
        const gx = r.x + x;
        const gy = r.y + y;
        if (!(gx < 40 || gx >= 280 || gy < 20 || gy >= 220)) continue;
        for (let k = 0; k < 4; k++) if (extreme.patch[(y * r.width + x) * 4 + k] !== img.data[(gy * w + gx) * 4 + k]) changed++;
      }
    expect(changed).toBe(0);
  });

  it("throws on an empty mask", () => {
    const s = new EnhanceSession();
    s.setImage(toRGBA(new Float32Array(100).fill(0.5), 10, 10));
    s.setMask(new Uint8Array(100), 1);
    expect(() => s.run(DEFAULT_PARAMS)).toThrow(/empty/);
  });
});

describe("detect", () => {
  it("finds a salient off-centre disk", () => {
    const w = 400;
    const h = 300;
    const y = new Float32Array(w * h).fill(0.35);
    const cx = 250;
    const cy = 140;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) if ((i - cx) ** 2 + (j - cy) ** 2 < 60 * 60) y[j * w + i] = 0.9;
    const img = toRGBA(gaussianBlur(y, w, h, 3), w, h, [1, 0.6, 0.4]);
    const res = detectSubject(img, "subject");
    expect(res.fallback).toBe(false);
    expect(res.bbox).not.toBeNull();
    const b = res.bbox!;
    expect(Math.abs(b.x + b.width / 2 - cx)).toBeLessThan(20);
    expect(Math.abs(b.y + b.height / 2 - cy)).toBeLessThan(20);
    expect(b.width).toBeGreaterThan(90);
    expect(b.width).toBeLessThan(170);
  });

  it("falls back to a centred ellipse on a featureless image", () => {
    const img = toRGBA(new Float32Array(200 * 100).fill(0.5), 200, 100);
    const res = detectSubject(img, "soft-focus");
    expect(res.fallback).toBe(true);
    expect(res.coverage).toBeGreaterThan(0.1);
  });
});
