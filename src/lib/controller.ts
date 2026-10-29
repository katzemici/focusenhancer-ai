import type { DetectMode } from "@/engine/types";
import { compressCanvas, type CompressResult, type CompressSettings } from "@/lib/compress";
import { EngineClient } from "@/lib/engineClient";
import { DecodeError, decodeFile, formatBytes } from "@/lib/image";
import { Workspace } from "@/lib/workspace";
import { useEditor } from "@/store/editor";

/**
 * Orchestrates the editing session: file decode → worker load → detection → enhancement
 * → export. Holds the singletons that must not live in React state.
 */

let engine: EngineClient | null = null;
let workspace: Workspace | null = null;
let session = 0;
let enhanceRunning = false;
let enhancePending = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function getEngine(): EngineClient {
  if (!engine) engine = new EngineClient();
  return engine;
}

export function getWorkspace(): Workspace | null {
  return workspace;
}

const store = () => useEditor.getState();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function loadFile(file: File): Promise<void> {
  const s = store();
  if (s.status === "loading") return;
  s.set({ status: "loading" });
  const mySession = ++session;
  try {
    const decoded = await decodeFile(file);
    const ws = new Workspace(decoded.canvas);
    const pixels = ws.readPixels();
    await getEngine().request(
      { type: "load", width: ws.width, height: ws.height, buffer: pixels.data.buffer as ArrayBuffer },
      [pixels.data.buffer as ArrayBuffer],
    );
    if (mySession !== session) return;
    workspace = ws;
    compressed = null;
    store().set({
      file: {
        name: file.name,
        size: file.size,
        type: file.type || "unknown",
        width: decoded.width,
        height: decoded.height,
        sourceWidth: decoded.sourceWidth,
        sourceHeight: decoded.sourceHeight,
        downscaled: decoded.downscaled,
        kind: decoded.kind,
      },
      session: store().session + 1,
      status: "idle",
      stats: null,
      hasResult: false,
      resultStale: false,
      canUndo: false,
      canRedo: false,
      maskEmpty: true,
      brushSize: Math.max(16, Math.round(Math.min(decoded.width, decoded.height) / 12)),
      estimate: null,
    });
    refreshEstimate(0);
    if (decoded.downscaled) {
      store().toast(
        "info",
        `Large input (${decoded.sourceWidth}×${decoded.sourceHeight}) was resized to ${decoded.width}×${decoded.height} for in-browser processing.`,
      );
    }
    if (decoded.kind === "video-frame") store().toast("info", "Loaded a still frame from the WebM clip.");
    await detect("soft-focus", { silent: true });
  } catch (err) {
    if (mySession !== session) return;
    store().set({ status: "idle" });
    store().toast("error", err instanceof DecodeError ? err.message : `Could not open file: ${errorMessage(err)}`);
  }
}

export async function detect(mode: DetectMode, opts: { silent?: boolean } = {}): Promise<void> {
  const ws = workspace;
  if (!ws || store().status === "detecting") return;
  const mySession = session;
  store().set({ status: "detecting" });
  try {
    const res = await getEngine().request({ type: "detect", mode });
    if (mySession !== session || ws !== workspace) return;
    ws.checkpoint();
    ws.setMaskPlane(new Uint8Array(res.mask));
    store().set({ status: "idle" });
    maskEdited({ immediate: true });
    if (res.fallback) {
      store().toast("info", "No distinct subject found. A centred region was selected; refine it with the brush.");
    } else if (!opts.silent) {
      store().toast("success", `Subject selected (${Math.round(res.coverage * 100)}% of frame).`);
    }
  } catch (err) {
    store().set({ status: "idle" });
    store().toast("error", `Detection failed: ${errorMessage(err)}`);
  }
}

/** Call after any mask edit is finished (stroke end, box release, undo, clear...). */
export function maskEdited(opts: { immediate?: boolean } = {}): void {
  const ws = workspace;
  if (!ws) return;
  const empty = ws.isMaskEmpty();
  store().set({
    canUndo: ws.canUndo(),
    canRedo: ws.canRedo(),
    maskEmpty: empty,
    resultStale: store().hasResult,
  });
  if (empty) {
    ws.clearResult();
    store().set({ hasResult: false, resultStale: false, stats: null });
    refreshEstimate();
    return;
  }
  if (store().autoPreview) scheduleEnhance(opts.immediate ? 0 : 150);
}

export function paramsChanged(): void {
  if (workspace && store().autoPreview && !store().maskEmpty) scheduleEnhance(120);
}

export function scheduleEnhance(delay: number): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void enhance();
  }, delay);
}

/**
 * Runs enhancement with the latest params/mask. Calls made while a run is in flight are
 * coalesced into one follow-up run, so slider drags never queue up stale work.
 */
export async function enhance(): Promise<void> {
  if (!workspace) return;
  if (enhanceRunning) {
    enhancePending = true;
    return;
  }
  enhanceRunning = true;
  try {
    do {
      enhancePending = false;
      const ws: Workspace | null = workspace;
      if (!ws) break;
      const mySession = session;
      const mask = ws.takeMaskIfChanged();
      if (mask?.empty || (!mask && ws.isMaskEmpty())) {
        ws.clearResult();
        store().set({ hasResult: false, resultStale: false, stats: null, maskEmpty: true });
        refreshEstimate();
        break;
      }
      store().set({ status: "enhancing" });
      const params = { ...store().params };
      const transfer = mask ? [mask.plane.buffer as ArrayBuffer] : [];
      const res = await getEngine().request(
        {
          type: "enhance",
          params,
          mask: mask ? { buffer: mask.plane.buffer as ArrayBuffer, version: mask.version } : undefined,
        },
        transfer,
      );
      if (mySession !== session || ws !== workspace) break;
      ws.setResult(new Uint8ClampedArray(res.patch), res.roi);
      store().set({ hasResult: true, resultStale: enhancePending, stats: res.stats });
      refreshEstimate();
    } while (enhancePending);
  } catch (err) {
    store().toast("error", errorMessage(err));
  } finally {
    enhanceRunning = false;
    if (store().status === "enhancing") store().set({ status: "idle" });
  }
}

export function undo(): void {
  if (workspace?.undo()) maskEdited({ immediate: true });
}

export function redo(): void {
  if (workspace?.redo()) maskEdited({ immediate: true });
}

export function clearMask(): void {
  if (!workspace || workspace.isMaskEmpty()) return;
  workspace.checkpoint();
  workspace.clearMask();
  maskEdited();
}

export function invertMask(): void {
  if (!workspace) return;
  workspace.checkpoint();
  workspace.invertMask();
  maskEdited();
}

// ---------- compressor ----------

let compressed: { key: string; result: CompressResult } | null = null;
let estimateTimer: ReturnType<typeof setTimeout> | null = null;
let estimateToken = 0;

function compressSettings(): CompressSettings {
  const s = store();
  return { format: s.exportFormat, mode: s.compressMode, quality: s.exportQuality, targetBytes: s.targetBytes, maxEdge: s.maxEdge };
}

function compressKey(ws: Workspace, c: CompressSettings): string {
  return JSON.stringify([ws.resultVersion, c]);
}

async function runCompression(ws: Workspace): Promise<CompressResult> {
  const settings = compressSettings();
  const key = compressKey(ws, settings);
  if (compressed?.key === key) return compressed.result;
  const result = await compressCanvas(ws.renderOutput(settings.format === "jpeg"), settings);
  compressed = { key, result };
  return result;
}

/** Re-computes the export size estimate shortly after settings or the result change. */
export function refreshEstimate(delay = 350): void {
  if (estimateTimer) clearTimeout(estimateTimer);
  estimateTimer = setTimeout(async () => {
    estimateTimer = null;
    const ws = workspace;
    if (!ws) return;
    const token = ++estimateToken;
    store().set({ estimating: true });
    try {
      const r = await runCompression(ws);
      if (token !== estimateToken || ws !== workspace) return;
      store().set({
        estimate: { bytes: r.blob.size, width: r.width, height: r.height, quality: r.quality, metTarget: r.metTarget },
      });
    } catch {
      if (token === estimateToken) store().set({ estimate: null });
    } finally {
      if (token === estimateToken) store().set({ estimating: false });
    }
  }, delay);
}

const EXT = { png: "png", jpeg: "jpg", webp: "webp" } as const;

export async function exportImage(): Promise<void> {
  const ws = workspace;
  const s = store();
  if (!ws || !s.file) return;
  try {
    const r = await runCompression(ws);
    const base = s.file.name.replace(/\.[^.]+$/, "") || "image";
    const ext = EXT[s.exportFormat];
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}-enhanced.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    const size = formatBytes(r.blob.size);
    const q = r.quality !== null ? `, quality ${Math.round(r.quality * 100)}` : "";
    s.toast(r.metTarget ? "success" : "info", `Exported ${r.width}×${r.height} ${ext.toUpperCase()} (${size}${q}).${r.metTarget ? "" : " Target size not reachable; used the lowest quality."}`);
  } catch (err) {
    s.toast("error", `Export failed: ${errorMessage(err)}`);
  }
}

export function closeImage(): void {
  session++;
  workspace = null;
  compressed = null;
  store().set({ file: null, hasResult: false, resultStale: false, stats: null, maskEmpty: true, status: "idle", estimate: null });
}

/** Turning extreme mode off pulls any >100% sliders back into the normal range. */
export function setExtreme(on: boolean): void {
  const p = store().params;
  store().setParams(on ? { extreme: true } : { extreme: false, deblur: Math.min(p.deblur, 100), clarity: Math.min(p.clarity, 100) });
  paramsChanged();
}
