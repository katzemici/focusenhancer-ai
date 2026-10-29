import type { ResponseOf, WorkerRequest, WorkerResponse } from "@/worker/protocol";

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

/** Distributive Omit so each union member keeps its own fields. */
type RequestBody = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, "id"> : never) : never;

/**
 * Promise-based wrapper around the engine worker. The worker processes messages in order,
 * so responses resolve in the same order the requests were sent.
 */
export class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL("../worker/engine.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.type === "error") p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || "Engine worker crashed");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  request<T extends RequestBody>(body: T, transfer: Transferable[] = []): Promise<ResponseOf<T["type"]>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: WorkerResponse) => void, reject });
      this.worker.postMessage({ ...body, id } as WorkerRequest, transfer);
    });
  }

  dispose(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error("Engine disposed"));
    this.pending.clear();
  }
}
