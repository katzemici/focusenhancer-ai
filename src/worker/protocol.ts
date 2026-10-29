import type { DetectMode, EnhanceParams, EnhanceStats, Rect } from "@/engine/types";

/** Messages from the UI thread to the engine worker. */
export type WorkerRequest =
  | { type: "load"; id: number; width: number; height: number; buffer: ArrayBuffer }
  | { type: "detect"; id: number; mode: DetectMode }
  | {
      type: "enhance";
      id: number;
      params: EnhanceParams;
      /** Sent only when the mask changed since the last enhance. */
      mask?: { buffer: ArrayBuffer; version: number };
    };

/** Messages from the engine worker back to the UI thread. */
export type WorkerResponse =
  | { type: "loaded"; id: number }
  | { type: "detected"; id: number; mask: ArrayBuffer; bbox: Rect | null; coverage: number; fallback: boolean }
  | { type: "enhanced"; id: number; patch: ArrayBuffer; roi: Rect; stats: EnhanceStats }
  | { type: "error"; id: number; message: string };

export type ResponseOf<T extends WorkerRequest["type"]> = T extends "load"
  ? Extract<WorkerResponse, { type: "loaded" }>
  : T extends "detect"
    ? Extract<WorkerResponse, { type: "detected" }>
    : Extract<WorkerResponse, { type: "enhanced" }>;
