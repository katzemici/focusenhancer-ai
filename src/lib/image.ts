/** Client-side decoding of uploaded files into an sRGB canvas. */

export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "video/webm"] as const;
export const ACCEPT_ATTR = ".png,.jpg,.jpeg,.webp,.webm,image/png,image/jpeg,image/webp,video/webm";
/** Upper bound on working resolution; larger inputs are downscaled to stay within browser canvas/memory limits. */
export const MAX_PIXELS = 40_000_000;
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

export interface DecodedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Original pixel dimensions before any downscale. */
  sourceWidth: number;
  sourceHeight: number;
  downscaled: boolean;
  kind: "image" | "video-frame";
}

export class DecodeError extends Error {}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isAccepted(file: File): boolean {
  if ((ACCEPTED_TYPES as readonly string[]).includes(file.type)) return true;
  return ["png", "jpg", "jpeg", "webp", "webm"].includes(extOf(file.name));
}

function isVideo(file: File): boolean {
  return file.type === "video/webm" || extOf(file.name) === "webm";
}

function fit(w: number, h: number): { w: number; h: number; scaled: boolean } {
  const px = w * h;
  if (px <= MAX_PIXELS) return { w, h, scaled: false };
  const s = Math.sqrt(MAX_PIXELS / px);
  return { w: Math.floor(w * s), h: Math.floor(h * s), scaled: true };
}

function toCanvas(source: CanvasImageSource, sw: number, sh: number, kind: DecodedImage["kind"]): DecodedImage {
  const { w, h, scaled } = fit(sw, sh);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new DecodeError("Canvas 2D is not available in this browser.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return { canvas, width: w, height: h, sourceWidth: sw, sourceHeight: sh, downscaled: scaled, kind };
}

async function decodeImage(file: File): Promise<DecodedImage> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new DecodeError("This file could not be decoded as an image.");
  }
  try {
    return toCanvas(bmp, bmp.width, bmp.height, "image");
  } finally {
    bmp.close();
  }
}

/** Grabs a single frame from a WebM clip (at 10% of its duration, max 1 s in). */
async function decodeVideoFrame(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new DecodeError("This WebM file could not be decoded."));
    });
    const d = Number.isFinite(video.duration) ? video.duration : 0;
    const t = Math.min(1, d * 0.1);
    if (t > 0) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = t;
      });
    }
    if (!video.videoWidth || !video.videoHeight) throw new DecodeError("The WebM file has no video track.");
    return toCanvas(video, video.videoWidth, video.videoHeight, "video-frame");
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function decodeFile(file: File): Promise<DecodedImage> {
  if (!isAccepted(file)) throw new DecodeError("Unsupported file type. Use PNG, JPEG, WebP or WebM.");
  if (file.size > MAX_FILE_BYTES) throw new DecodeError("File is larger than 200 MB.");
  return isVideo(file) ? decodeVideoFrame(file) : decodeImage(file);
}

export function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** "3:2", "16:9", or a decimal ratio when the reduced fraction is unwieldy. */
export function aspectLabel(w: number, h: number): string {
  const g = gcd(w, h);
  const a = w / g;
  const b = h / g;
  if (a <= 32 && b <= 32) return `${a}:${b}`;
  return `${(w / h).toFixed(2)}:1`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function megapixels(w: number, h: number): string {
  return `${((w * h) / 1e6).toFixed(1)} MP`;
}
