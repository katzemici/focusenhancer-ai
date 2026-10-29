import { create } from "zustand";
import { DEFAULT_PARAMS, type EnhanceParams, type EnhanceStats } from "@/engine/types";
import type { CompressFormat, CompressMode } from "@/lib/compress";
import type { MaskOp } from "@/lib/workspace";

export type Tool = "pan" | "brush" | "box";
export type CompareMode = "split" | "side" | "before" | "after";
export type ExportFormat = CompressFormat;
export type Status = "idle" | "loading" | "detecting" | "enhancing";

export interface FileMeta {
  name: string;
  size: number;
  type: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  downscaled: boolean;
  kind: "image" | "video-frame";
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
}

export interface EditorState {
  file: FileMeta | null;
  /** Increments for each newly loaded image; components key on it. */
  session: number;
  tool: Tool;
  maskOp: MaskOp;
  /** Brush diameter in image pixels. */
  brushSize: number;
  showMask: boolean;
  compare: CompareMode;
  /** Split divider position as a fraction of viewport width. */
  split: number;
  params: EnhanceParams;
  autoPreview: boolean;
  status: Status;
  /** Progress label for long operations. */
  stats: EnhanceStats | null;
  hasResult: boolean;
  /** True when params or mask changed since the shown result was computed. */
  resultStale: boolean;
  canUndo: boolean;
  canRedo: boolean;
  maskEmpty: boolean;
  zoom: number;
  exportFormat: ExportFormat;
  exportQuality: number;
  compressMode: CompressMode;
  targetBytes: number;
  maxEdge: number | null;
  estimate: { bytes: number; width: number; height: number; quality: number | null; metTarget: boolean } | null;
  estimating: boolean;
  toasts: Toast[];

  set: (patch: Partial<EditorState>) => void;
  setParams: (patch: Partial<EnhanceParams>) => void;
  toast: (kind: Toast["kind"], message: string) => void;
  dismissToast: (id: number) => void;
}

let toastId = 1;

export const useEditor = create<EditorState>((set) => ({
  file: null,
  session: 0,
  tool: "brush",
  maskOp: "add",
  brushSize: 120,
  showMask: true,
  compare: "split",
  split: 0.5,
  params: { ...DEFAULT_PARAMS },
  autoPreview: true,
  status: "idle",
  stats: null,
  hasResult: false,
  resultStale: false,
  canUndo: false,
  canRedo: false,
  maskEmpty: true,
  zoom: 1,
  exportFormat: "png",
  exportQuality: 92,
  compressMode: "quality",
  targetBytes: 1024 * 1024,
  maxEdge: null,
  estimate: null,
  estimating: false,
  toasts: [],

  set: (patch) => set(patch),
  setParams: (patch) => set((s) => ({ params: { ...s.params, ...patch }, resultStale: s.hasResult || s.resultStale })),
  toast: (kind, message) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 6000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
