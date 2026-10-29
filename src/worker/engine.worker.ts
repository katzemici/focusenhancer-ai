/// <reference lib="webworker" />
import { detectSubject } from "@/engine/detect";
import { EnhanceSession } from "@/engine/pipeline";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const session = new EnhanceSession();

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function handle(req: WorkerRequest): void {
  switch (req.type) {
    case "load": {
      session.setImage({ width: req.width, height: req.height, data: new Uint8ClampedArray(req.buffer) });
      post({ type: "loaded", id: req.id });
      return;
    }
    case "detect": {
      const img = session.getImage();
      if (!img) throw new Error("No image loaded");
      const res = detectSubject(img, req.mode);
      post(
        { type: "detected", id: req.id, mask: res.mask.buffer as ArrayBuffer, bbox: res.bbox, coverage: res.coverage, fallback: res.fallback },
        [res.mask.buffer as ArrayBuffer],
      );
      return;
    }
    case "enhance": {
      if (req.mask) session.setMask(new Uint8Array(req.mask.buffer), req.mask.version);
      const out = session.run(req.params);
      post({ type: "enhanced", id: req.id, patch: out.patch.buffer as ArrayBuffer, roi: out.roi, stats: out.stats }, [
        out.patch.buffer as ArrayBuffer,
      ]);
      return;
    }
  }
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    handle(req);
  } catch (err) {
    post({ type: "error", id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
};
