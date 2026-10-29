import { deconvolve } from "./deconv";
import { applyClarity, blendByWeight, blurAdaptiveWeight, suppressRinging, transferGrain } from "./detail";
import { clamp, luminance } from "./filters";
import { buildAlpha, expandRect, maskBounds } from "./mask";
import { estimateNoise } from "./noise";
import { SIGMA_MAX, estimateBlurSigma } from "./psf";
import { EXTREME_MAX, NORMAL_MAX, type EnhanceOutput, type EnhanceParams, type RGBAImage, type Rect } from "./types";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export interface ResolvedStrength {
  /** Multiplier on the estimated PSF sigma used for deconvolution. */
  sigmaFactor: number;
  /** Multiplier on Wiener regularization (smaller = harder inverse). */
  lambdaScale: number;
  /** Multiplier on the ringing clamp slack. */
  slackScale: number;
  /** 0..1 floor added to the sharp-edge guard weight. */
  guardFloor: number;
  /** Clarity amount (1 = 100%). */
  clarity: number;
}

/**
 * Maps user sliders to internal strengths. Normal mode caps at 100% and keeps every
 * safeguard at full strength. Extreme mode only changes behaviour above 100%; at or
 * below 100% the output is identical to normal mode.
 */
export function resolveStrength(p: EnhanceParams): ResolvedStrength {
  const max = p.extreme ? EXTREME_MAX : NORMAL_MAX;
  const d = clamp(p.deblur, 0, max) / 100;
  const c = clamp(p.clarity, 0, max) / 100;
  if (d <= 1) return { sigmaFactor: d, lambdaScale: 1, slackScale: 1, guardFloor: 0, clarity: c };
  // e ∈ (0, 1] over the 100%..300% range.
  const e = (d - 1) / ((EXTREME_MAX - 100) / 100);
  return {
    sigmaFactor: 1 + 0.6 * e, // over-correct the PSF by up to 60%
    lambdaScale: Math.pow(10, -2 * e), // up to 100× weaker regularization
    slackScale: 1 + 5 * e, // up to 6× looser halo clamp
    guardFloor: 0.85 * e, // nearly disables the sharp-edge guard
    clarity: c,
  };
}

export function cropRGBA(img: RGBAImage, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  for (let y = 0; y < r.height; y++) {
    const s = ((r.y + y) * img.width + r.x) * 4;
    out.set(img.data.subarray(s, s + r.width * 4), y * r.width * 4);
  }
  return out;
}

export function cropPlane(src: Uint8Array, w: number, r: Rect): Uint8Array {
  const out = new Uint8Array(r.width * r.height);
  for (let y = 0; y < r.height; y++) {
    const s = (r.y + y) * w + r.x;
    out.set(src.subarray(s, s + r.width), y * r.width);
  }
  return out;
}

/** Writes an RGBA patch back into an image in place. */
export function pasteRGBA(img: RGBAImage, patch: Uint8ClampedArray, r: Rect): void {
  for (let y = 0; y < r.height; y++) {
    const d = ((r.y + y) * img.width + r.x) * 4;
    img.data.set(patch.subarray(y * r.width * 4, (y + 1) * r.width * 4), d);
  }
}

/**
 * Applies a luminance delta to RGB, weighted by alpha. Adding the same delta to R, G and B
 * changes brightness/detail only, so chroma (and skin tone) is not altered.
 * Pixels with alpha 0 are copied verbatim.
 */
export function composeLuminanceDelta(
  rgba: Uint8ClampedArray,
  original: Float32Array,
  restored: Float32Array,
  alpha: Float32Array,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
    const a = alpha[i];
    if (a === 0) continue;
    const d = (restored[i] - original[i]) * a * 255;
    out[j] = rgba[j] + d;
    out[j + 1] = rgba[j + 1] + d;
    out[j + 2] = rgba[j + 2] + d;
  }
  return out;
}

interface RegionState {
  key: string;
  roi: Rect;
  rgba: Uint8ClampedArray;
  y: Float32Array;
  alpha: Float32Array;
  noise: number;
  autoSigma: number;
  autoConfidence: number;
}

/**
 * Stateful wrapper around the restoration pipeline. Caches per-image, per-mask and
 * per-PSF intermediates so that changing fidelity/clarity re-runs only the cheap stages.
 *
 * Pipeline (luminance only, inside the padded mask bounding box):
 *   1. noise estimate + blind PSF size estimate on masked edges
 *   2. regularized Wiener deconvolution with σ_corr = σ · deblur
 *   3. ringing clamp to the local source range (tighter with higher fidelity)
 *   4. fine-grain transfer from the source (fidelity)
 *   5. noise-gated clarity
 *   6. guided-filter feathered alpha blend; alpha 0 pixels stay bit-identical
 */
export class EnhanceSession {
  private image: RGBAImage | null = null;
  private mask: Uint8Array | null = null;
  private maskVersion = -1;
  private region: RegionState | null = null;
  private deconvCache: { key: string; data: Float32Array; weight: Float32Array } | null = null;

  setImage(img: RGBAImage): void {
    if (img.data.length !== img.width * img.height * 4) throw new Error("Image buffer size mismatch");
    this.image = img;
    this.mask = null;
    this.maskVersion = -1;
    this.region = null;
    this.deconvCache = null;
  }

  hasImage(): boolean {
    return this.image !== null;
  }

  getImage(): RGBAImage | null {
    return this.image;
  }

  setMask(mask: Uint8Array, version: number): void {
    const img = this.requireImage();
    if (mask.length !== img.width * img.height) throw new Error("Mask size mismatch");
    this.mask = mask;
    this.maskVersion = version;
  }

  getMaskVersion(): number {
    return this.maskVersion;
  }

  run(params: EnhanceParams): EnhanceOutput {
    this.requireImage();
    if (!this.mask) throw new Error("No mask selected");
    const timings: Record<string, number> = {};
    let t = now();
    const mark = (name: string) => {
      const n = now();
      timings[name] = Math.round(n - t);
      t = n;
    };

    const feather = clamp(Math.round(params.feather), 0, 128);
    const region = this.prepareRegion(feather);
    mark("region");

    const { roi, y, alpha, noise } = region;
    const manual = params.blurSigma !== null && Number.isFinite(params.blurSigma);
    const sigma = manual ? clamp(params.blurSigma as number, 0.1, SIGMA_MAX) : region.autoSigma;
    const x = resolveStrength(params);
    const sigmaCorr = sigma * x.sigmaFactor;

    let restored: Float32Array;
    if (sigmaCorr >= 0.15) {
      // Deconvolution depends only on the ROI pixels and the PSF (not on the mask or feather),
      // so mask edits that keep the same ROI reuse it. setImage() clears this cache.
      const key = `${roi.x},${roi.y},${roi.width},${roi.height}|${params.psf}|${sigmaCorr.toFixed(3)}|${x.lambdaScale.toFixed(4)}`;
      let weight: Float32Array;
      if (this.deconvCache?.key === key) {
        restored = this.deconvCache.data;
        weight = this.deconvCache.weight;
      } else {
        restored = deconvolve(y, roi.width, roi.height, { model: params.psf, sigma: sigmaCorr, noise, lambdaScale: x.lambdaScale });
        weight = blurAdaptiveWeight(y, roi.width, roi.height, sigmaCorr, noise);
        this.deconvCache = { key, data: restored, weight };
      }
      mark("deconvolve");
      const f = clamp(params.fidelity, 0, 100) / 100;
      const radius = Math.ceil(2.5 * sigmaCorr) + 1;
      const slack = (0.12 * (1 - f) + 0.01) * x.slackScale;
      restored = suppressRinging(restored, y, roi.width, roi.height, radius, slack);
      restored = transferGrain(restored, y, roi.width, roi.height, f);
      // Leave already-sharp detail inside the mask alone (prevents halos on in-focus edges).
      // Extreme mode lifts the guard's floor so everything in the mask gets hit.
      if (x.guardFloor > 0) {
        const lifted = new Float32Array(weight.length);
        for (let i = 0; i < weight.length; i++) lifted[i] = weight[i] + x.guardFloor * (1 - weight[i]);
        weight = lifted;
      }
      restored = blendByWeight(restored, y, weight);
      mark("fidelity");
    } else {
      restored = y;
    }

    if (x.clarity > 0) {
      const radius = clamp(Math.round(Math.sqrt(roi.width * roi.height) / 60), 4, 24);
      restored = applyClarity(restored, roi.width, roi.height, x.clarity, noise, radius);
      mark("clarity");
    }

    const patch = composeLuminanceDelta(region.rgba, y, restored, alpha);
    mark("compose");

    return {
      patch,
      roi,
      stats: {
        roi,
        sigma,
        sigmaSource: manual ? "manual" : "auto",
        sigmaConfidence: manual ? 1 : region.autoConfidence,
        noise,
        timings,
      },
    };
  }

  private requireImage(): RGBAImage {
    if (!this.image) throw new Error("No image loaded");
    return this.image;
  }

  private prepareRegion(feather: number): RegionState {
    const img = this.requireImage();
    const mask = this.mask as Uint8Array;
    const key = `${this.maskVersion}|${feather}`;
    if (this.region?.key === key) return this.region;

    const bounds = maskBounds(mask, img.width, img.height);
    if (!bounds) throw new Error("The mask is empty. Paint or detect a subject first.");
    // Padding covers the feather falloff plus the deconvolution overlap at max PSF size,
    // so crop-border effects never reach pixels that receive non-zero alpha.
    const pad = Math.ceil(3 * feather) + 96;
    const roi = expandRect(bounds, pad, img.width, img.height);
    const rgba = cropRGBA(img, roi);
    const y = luminance(rgba, roi.width, roi.height);
    const maskCrop = cropPlane(mask, img.width, roi);
    const alpha = buildAlpha(maskCrop, y, roi.width, roi.height, feather);
    const noise = estimateNoise(y, roi.width, roi.height);
    const weight = new Float32Array(maskCrop.length);
    for (let i = 0; i < weight.length; i++) weight[i] = maskCrop[i] >= 128 ? 1 : 0;
    const est = estimateBlurSigma(y, roi.width, roi.height, { weight, noise });

    this.region = {
      key,
      roi,
      rgba,
      y,
      alpha,
      noise,
      autoSigma: est.sigma,
      autoConfidence: est.confidence,
    };
    return this.region;
  }
}
