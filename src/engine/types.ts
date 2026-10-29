/**
 * Shared engine types. The engine is pure TypeScript with no DOM dependencies so it
 * can run inside a Web Worker and under Node (unit tests).
 */

export interface RGBAImage {
  width: number;
  height: number;
  /** Interleaved RGBA, 8 bits per channel, row-major. */
  data: Uint8ClampedArray;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Point-spread-function model used for deconvolution.
 * - gaussian: generic soft/motion-less defocus, most stable.
 * - disk: optical defocus of a circular aperture (stronger, can ring more).
 */
export type PsfModel = "gaussian" | "disk";

export interface EnhanceParams {
  /** 0..100 (0..EXTREME_MAX in extreme mode). Fraction of the estimated blur that is corrected. 0 = identity. */
  deblur: number;
  /** 0..100. Higher keeps original grain and clamps output tighter to the source. */
  fidelity: number;
  /** 0..100 (0..EXTREME_MAX in extreme mode). Noise-aware micro-contrast and edge sharpness inside the mask. */
  clarity: number;
  /** Feather width of the blend edge, in image pixels. */
  feather: number;
  psf: PsfModel;
  /** PSF size (Gaussian sigma in px; disk radius = 2*sigma). null = estimate automatically. */
  blurSigma: number | null;
  /**
   * "Absurdly high" mode. Allows deblur/clarity above 100%, over-corrects the PSF,
   * weakens regularization and relaxes the halo clamp and sharp-edge guard.
   * Produces visible artifacts by design; never on by default.
   */
  extreme: boolean;
}

export const NORMAL_MAX = 100;
export const EXTREME_MAX = 300;

export const DEFAULT_PARAMS: EnhanceParams = {
  deblur: 70,
  fidelity: 65,
  clarity: 30,
  feather: 12,
  psf: "gaussian",
  blurSigma: null,
  extreme: false,
};

export interface EnhanceStats {
  roi: Rect;
  /** PSF sigma that was estimated or provided (before deblur scaling). */
  sigma: number;
  sigmaSource: "auto" | "manual";
  /** Confidence of the automatic estimate, 0..1. */
  sigmaConfidence: number;
  /** Estimated noise standard deviation (luminance, 0..1 scale). */
  noise: number;
  timings: Record<string, number>;
}

export interface EnhanceOutput {
  /** RGBA pixels covering `roi`, already blended with the original. */
  patch: Uint8ClampedArray;
  roi: Rect;
  stats: EnhanceStats;
}

export type DetectMode = "subject" | "soft-focus";

export interface DetectResult {
  /** Full-resolution mask, 0 or 255 per pixel. */
  mask: Uint8Array;
  bbox: Rect | null;
  /** Fraction of the image covered by the mask. */
  coverage: number;
  /** True when the detector found nothing convincing and fell back to a centered ellipse. */
  fallback: boolean;
}
