import type { Rect } from "@/engine/types";

/** Mask paint colour. RGB is only for display; the alpha channel is the mask. */
export const MASK_RGB = [59, 130, 246] as const;
const MASK_FILL = `rgb(${MASK_RGB.join(",")})`;
const UNDO_BYTE_BUDGET = 400_000_000;

export type MaskOp = "add" | "subtract";

type Listener = () => void;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement, willRead = false): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: willRead });
  if (!ctx) throw new Error("Canvas 2D unavailable");
  return ctx;
}

/**
 * Owns the heavy, non-serializable state of an editing session: the original pixels, the
 * mask, the enhanced patch and undo history. React components subscribe for redraws.
 */
export class Workspace {
  readonly width: number;
  readonly height: number;
  readonly original: HTMLCanvasElement;
  readonly mask: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  /** Enhanced pixels covering `result.roi`; drawn over the original. */
  result: { canvas: HTMLCanvasElement; roi: Rect } | null = null;
  maskVersion = 0;
  private sentMaskVersion = -1;
  private undoStack: HTMLCanvasElement[] = [];
  private redoStack: HTMLCanvasElement[] = [];
  private readonly maxUndo: number;
  private listeners = new Set<Listener>();
  private maskEmptyCache: { version: number; empty: boolean } | null = null;

  constructor(original: HTMLCanvasElement) {
    this.original = original;
    this.width = original.width;
    this.height = original.height;
    this.mask = makeCanvas(this.width, this.height);
    this.maskCtx = ctx2d(this.mask);
    this.maxUndo = Math.max(3, Math.min(30, Math.floor(UNDO_BYTE_BUDGET / (this.width * this.height * 4))));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** RGBA copy of the original pixels (for the worker). */
  readPixels(): ImageData {
    return ctx2d(this.original).getImageData(0, 0, this.width, this.height);
  }

  // ---------- mask editing ----------

  private snapshot(): HTMLCanvasElement {
    const c = makeCanvas(this.width, this.height);
    ctx2d(c).drawImage(this.mask, 0, 0);
    return c;
  }

  private restore(from: HTMLCanvasElement): void {
    this.maskCtx.save();
    this.maskCtx.globalCompositeOperation = "copy";
    this.maskCtx.drawImage(from, 0, 0);
    this.maskCtx.restore();
  }

  /** Call once before a user edit so it can be undone. */
  checkpoint(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    this.redoStack = [];
  }

  private touched(): void {
    this.maskVersion++;
    this.emit();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
    this.touched();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.snapshot());
    this.restore(next);
    this.touched();
    return true;
  }

  private withOp(op: MaskOp, draw: (ctx: CanvasRenderingContext2D) => void): void {
    const ctx = this.maskCtx;
    ctx.save();
    ctx.globalCompositeOperation = op === "add" ? "source-over" : "destination-out";
    ctx.fillStyle = MASK_FILL;
    ctx.strokeStyle = MASK_FILL;
    draw(ctx);
    ctx.restore();
    this.touched();
  }

  /** Paints a round-capped stroke segment in image coordinates. */
  strokeSegment(x0: number, y0: number, x1: number, y1: number, radius: number, op: MaskOp): void {
    this.withOp(op, (ctx) => {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = radius * 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1 + (x0 === x1 && y0 === y1 ? 0.01 : 0), y1);
      ctx.stroke();
    });
  }

  fillRect(r: Rect, op: MaskOp): void {
    this.withOp(op, (ctx) => ctx.fillRect(r.x, r.y, r.width, r.height));
  }

  clearMask(): void {
    this.maskCtx.clearRect(0, 0, this.width, this.height);
    this.touched();
  }

  invertMask(): void {
    const img = this.maskCtx.getImageData(0, 0, this.width, this.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = MASK_RGB[0];
      d[i + 1] = MASK_RGB[1];
      d[i + 2] = MASK_RGB[2];
      d[i + 3] = 255 - d[i + 3];
    }
    this.maskCtx.putImageData(img, 0, 0);
    this.touched();
  }

  /** Replaces the mask with a 0..255 plane (e.g. from auto-detection). */
  setMaskPlane(plane: Uint8Array): void {
    const img = new ImageData(this.width, this.height);
    const d = img.data;
    for (let i = 0, j = 0; i < plane.length; i++, j += 4) {
      d[j] = MASK_RGB[0];
      d[j + 1] = MASK_RGB[1];
      d[j + 2] = MASK_RGB[2];
      d[j + 3] = plane[i];
    }
    this.maskCtx.putImageData(img, 0, 0);
    this.touched();
  }

  /** Alpha channel of the mask as a 0..255 plane. */
  readMaskPlane(): Uint8Array {
    const d = this.maskCtx.getImageData(0, 0, this.width, this.height).data;
    const out = new Uint8Array(this.width * this.height);
    for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = d[j];
    return out;
  }

  isMaskEmpty(): boolean {
    if (this.maskEmptyCache?.version === this.maskVersion) return this.maskEmptyCache.empty;
    return this.cacheEmpty(this.readMaskPlane());
  }

  private cacheEmpty(plane: Uint8Array): boolean {
    let empty = true;
    for (let i = 0; i < plane.length; i++)
      if (plane[i]) {
        empty = false;
        break;
      }
    this.maskEmptyCache = { version: this.maskVersion, empty };
    return empty;
  }

  /** Returns the mask plane only if it changed since the last call (for the worker). */
  takeMaskIfChanged(): { plane: Uint8Array; version: number; empty: boolean } | null {
    if (this.sentMaskVersion === this.maskVersion) return null;
    this.sentMaskVersion = this.maskVersion;
    const plane = this.readMaskPlane();
    return { plane, version: this.maskVersion, empty: this.cacheEmpty(plane) };
  }

  // ---------- result ----------

  setResult(patch: Uint8ClampedArray, roi: Rect): void {
    let canvas = this.result?.canvas;
    if (!canvas || canvas.width !== roi.width || canvas.height !== roi.height) canvas = makeCanvas(roi.width, roi.height);
    ctx2d(canvas).putImageData(new ImageData(new Uint8ClampedArray(patch), roi.width, roi.height), 0, 0);
    this.result = { canvas, roi };
    this.resultVersion++;
    this.emit();
  }

  clearResult(): void {
    this.result = null;
    this.resultVersion++;
    this.emit();
  }

  /** Draws the enhanced image (original + patch) into a context already transformed to image space. */
  drawAfter(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.original, 0, 0);
    if (this.result) ctx.drawImage(this.result.canvas, this.result.roi.x, this.result.roi.y);
  }

  /** Full-resolution enhanced image as a canvas (JPEG flattens alpha onto white). */
  renderOutput(flattenWhite: boolean): HTMLCanvasElement {
    const c = makeCanvas(this.width, this.height);
    const ctx = ctx2d(c);
    if (flattenWhite) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
    }
    this.drawAfter(ctx);
    return c;
  }

  /** Increments whenever the enhanced output changes (for export caching). */
  resultVersion = 0;
}
