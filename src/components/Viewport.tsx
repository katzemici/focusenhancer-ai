"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MoveHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getWorkspace, maskEdited } from "@/lib/controller";
import type { Workspace } from "@/lib/workspace";
import { useEditor } from "@/store/editor";

interface View {
  scale: number;
  /** Translation of image origin within a pane, in CSS px. */
  tx: number;
  ty: number;
}

type Drag =
  | { kind: "pan"; startX: number; startY: number; tx: number; ty: number }
  | { kind: "brush"; lastX: number; lastY: number; op: "add" | "subtract" }
  | { kind: "box"; x0: number; y0: number; x1: number; y1: number; op: "add" | "subtract" }
  | { kind: "split" };

const MIN_SCALE = 0.02;
const MAX_SCALE = 32;
const MASK_ALPHA = 0.38;

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ scale: 1, tx: 0, ty: 0 });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const dragRef = useRef<Drag | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const spaceRef = useRef(false);
  const frameRef = useRef(0);
  const [cursor, setCursor] = useState("default");

  const session = useEditor((s) => s.session);
  const compare = useEditor((s) => s.compare);
  const split = useEditor((s) => s.split);
  const showMask = useEditor((s) => s.showMask);
  const tool = useEditor((s) => s.tool);
  const status = useEditor((s) => s.status);
  const hasResult = useEditor((s) => s.hasResult);

  /** Pane geometry: side-by-side uses two half-width panes with a shared view. */
  const panes = useCallback((): { x: number; w: number; h: number }[] => {
    const { w, h } = sizeRef.current;
    if (useEditor.getState().compare === "side") {
      const half = Math.floor((w - 1) / 2);
      return [
        { x: 0, w: half, h },
        { x: w - half, w: half, h },
      ];
    }
    return [{ x: 0, w, h }];
  }, []);

  const toImage = useCallback(
    (cx: number, cy: number) => {
      const ps = panes();
      const pane = ps.length === 2 && cx >= ps[1].x ? ps[1] : ps[0];
      const v = viewRef.current;
      return { x: (cx - pane.x - v.tx) / v.scale, y: (cy - v.ty) / v.scale };
    },
    [panes],
  );

  // ---------- rendering ----------

  const drawOverlay = useCallback(() => {
    const ov = overlayRef.current;
    const ws = getWorkspace();
    if (!ov) return;
    const { w, h, dpr } = sizeRef.current;
    const ctx = ov.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!ws) return;
    const st = useEditor.getState();
    const v = viewRef.current;
    const p = pointerRef.current;
    const drag = dragRef.current;
    for (const pane of panes()) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(pane.x, 0, pane.w, pane.h);
      ctx.clip();
      if (drag?.kind === "box") {
        const x = pane.x + v.tx + Math.min(drag.x0, drag.x1) * v.scale;
        const y = v.ty + Math.min(drag.y0, drag.y1) * v.scale;
        const bw = Math.abs(drag.x1 - drag.x0) * v.scale;
        const bh = Math.abs(drag.y1 - drag.y0) * v.scale;
        ctx.fillStyle = drag.op === "add" ? "rgba(59,130,246,0.14)" : "rgba(239,68,68,0.12)";
        ctx.fillRect(x, y, bw, bh);
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = drag.op === "add" ? "#60A5FA" : "#f87171";
        ctx.strokeRect(x + 0.5, y + 0.5, bw, bh);
      }
      if (p && st.tool === "brush" && !spaceRef.current && dragRef.current?.kind !== "pan") {
        const img = toImage(p.x, p.y);
        const cx = pane.x + v.tx + img.x * v.scale;
        const cy = v.ty + img.y * v.scale;
        const r = Math.max(1, (st.brushSize / 2) * v.scale);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.stroke();
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = st.maskOp === "add" ? "rgba(147,197,253,0.95)" : "rgba(252,165,165,0.95)";
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [panes, toImage]);

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const ws = getWorkspace();
    if (!canvas) return;
    const { w, h, dpr } = sizeRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!ws) return;
    const st = useEditor.getState();
    const v = viewRef.current;
    // Show real pixels when inspecting closely; smooth when zoomed out.
    const smooth = v.scale * dpr < 2;

    const paint = (pane: { x: number; w: number; h: number }, which: "before" | "after", clipX?: [number, number]) => {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      const cx0 = clipX ? clipX[0] : pane.x;
      const cx1 = clipX ? clipX[1] : pane.x + pane.w;
      ctx.rect(cx0, 0, cx1 - cx0, pane.h);
      ctx.clip();
      ctx.translate(pane.x + v.tx, v.ty);
      ctx.scale(v.scale, v.scale);
      ctx.imageSmoothingEnabled = smooth;
      ctx.imageSmoothingQuality = "high";
      if (which === "after") ws.drawAfter(ctx);
      else ctx.drawImage(ws.original, 0, 0);
      if (st.showMask) {
        ctx.globalAlpha = MASK_ALPHA;
        ctx.drawImage(ws.mask, 0, 0);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    };

    const ps = panes();
    if (st.compare === "side") {
      paint(ps[0], "before");
      paint(ps[1], "after");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#1E293B";
      ctx.fillRect(ps[0].w, 0, ps[1].x - ps[0].w, h);
    } else if (st.compare === "split") {
      const sx = Math.round(st.split * w);
      paint(ps[0], "before", [0, sx]);
      paint(ps[0], "after", [sx, w]);
    } else {
      paint(ps[0], st.compare);
    }
    drawOverlay();
  }, [drawOverlay, panes]);

  const requestDraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // ---------- view helpers ----------

  const fit = useCallback(() => {
    const ws = getWorkspace();
    if (!ws) return;
    const pane = panes()[0];
    const pad = 32;
    const scale = Math.min((pane.w - pad * 2) / ws.width, (pane.h - pad * 2) / ws.height, 8);
    const s = Math.max(MIN_SCALE, scale);
    viewRef.current = { scale: s, tx: (pane.w - ws.width * s) / 2, ty: (pane.h - ws.height * s) / 2 };
    useEditor.getState().set({ zoom: s });
    requestDraw();
  }, [panes, requestDraw]);

  /** Zoom keeping the image point under (cx, cy) fixed. */
  const zoomAt = useCallback(
    (cx: number, cy: number, next: number) => {
      const v = viewRef.current;
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
      const ps = panes();
      const pane = ps.length === 2 && cx >= ps[1].x ? ps[1] : ps[0];
      const lx = cx - pane.x;
      const ix = (lx - v.tx) / v.scale;
      const iy = (cy - v.ty) / v.scale;
      viewRef.current = { scale: s, tx: lx - ix * s, ty: cy - iy * s };
      useEditor.getState().set({ zoom: s });
      requestDraw();
    },
    [panes, requestDraw],
  );

  // Expose zoom commands to the header/keyboard via a window event.
  useEffect(() => {
    const onCmd = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail;
      const { h } = sizeRef.current;
      const pane = panes()[0];
      const cx = pane.x + pane.w / 2;
      const v = viewRef.current;
      if (cmd === "fit") fit();
      else if (cmd === "in") zoomAt(cx, h / 2, v.scale * 1.25);
      else if (cmd === "out") zoomAt(cx, h / 2, v.scale / 1.25);
      else if (cmd === "100") zoomAt(cx, h / 2, 1 / sizeRef.current.dpr);
    };
    window.addEventListener("fe:view", onCmd);
    return () => window.removeEventListener("fe:view", onCmd);
  }, [fit, zoomAt, panes]);

  // ---------- sizing ----------

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const prev = sizeRef.current;
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      for (const c of [canvasRef.current, overlayRef.current]) {
        if (!c) continue;
        c.width = Math.round(rect.width * dpr);
        c.height = Math.round(rect.height * dpr);
      }
      if (prev.w === 0) fit();
      else requestDraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, requestDraw]);

  // Re-fit on new image; redraw on workspace changes.
  useEffect(() => {
    const ws = getWorkspace();
    if (!ws) return;
    fit();
    return ws.subscribe(requestDraw);
  }, [session, fit, requestDraw]);

  // Re-fit when switching to/from side-by-side (pane width changes).
  const prevCompare = useRef(compare);
  useEffect(() => {
    if ((prevCompare.current === "side") !== (compare === "side")) fit();
    prevCompare.current = compare;
    requestDraw();
  }, [compare, split, showMask, hasResult, fit, requestDraw]);

  useEffect(() => {
    drawOverlay();
  }, [tool, drawOverlay]);

  // ---------- keyboard ----------

  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) {
        if (!spaceRef.current) {
          spaceRef.current = true;
          setCursor("grab");
          drawOverlay();
        }
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setCursor("default");
        drawOverlay();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [drawOverlay]);

  // ---------- pointer ----------

  const local = (e: { clientX: number; clientY: number }) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const ws: Workspace | null = getWorkspace();
    if (!ws) return;
    const p = local(e);
    const st = useEditor.getState();
    (e.target as Element).setPointerCapture(e.pointerId);
    const wantsPan = e.button === 1 || e.button === 2 || spaceRef.current || st.tool === "pan";
    if (wantsPan) {
      dragRef.current = { kind: "pan", startX: p.x, startY: p.y, tx: viewRef.current.tx, ty: viewRef.current.ty };
      setCursor("grabbing");
      return;
    }
    if (e.button !== 0) return;
    const op = e.altKey ? (st.maskOp === "add" ? "subtract" : "add") : st.maskOp;
    const img = toImage(p.x, p.y);
    if (st.tool === "brush") {
      ws.checkpoint();
      ws.strokeSegment(img.x, img.y, img.x, img.y, st.brushSize / 2, op);
      dragRef.current = { kind: "brush", lastX: img.x, lastY: img.y, op };
    } else if (st.tool === "box") {
      dragRef.current = { kind: "box", x0: img.x, y0: img.y, x1: img.x, y1: img.y, op };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    pointerRef.current = p;
    const drag = dragRef.current;
    const ws = getWorkspace();
    if (!drag || !ws) {
      drawOverlay();
      return;
    }
    if (drag.kind === "pan") {
      viewRef.current = { ...viewRef.current, tx: drag.tx + p.x - drag.startX, ty: drag.ty + p.y - drag.startY };
      requestDraw();
    } else if (drag.kind === "brush") {
      const img = toImage(p.x, p.y);
      ws.strokeSegment(drag.lastX, drag.lastY, img.x, img.y, useEditor.getState().brushSize / 2, drag.op);
      drag.lastX = img.x;
      drag.lastY = img.y;
    } else if (drag.kind === "box") {
      const img = toImage(p.x, p.y);
      drag.x1 = Math.max(0, Math.min(ws.width, img.x));
      drag.y1 = Math.max(0, Math.min(ws.height, img.y));
      drawOverlay();
    }
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    const ws = getWorkspace();
    if (!drag || !ws) return;
    if (drag.kind === "pan") {
      setCursor(spaceRef.current ? "grab" : "default");
    } else if (drag.kind === "brush") {
      maskEdited();
    } else if (drag.kind === "box") {
      const x = Math.max(0, Math.min(drag.x0, drag.x1));
      const y = Math.max(0, Math.min(drag.y0, drag.y1));
      const bw = Math.min(ws.width, Math.max(drag.x0, drag.x1)) - x;
      const bh = Math.min(ws.height, Math.max(drag.y0, drag.y1)) - y;
      if (bw >= 4 && bh >= 4) {
        ws.checkpoint();
        ws.fillRect({ x, y, width: bw, height: bh }, drag.op);
        maskEdited();
      }
      drawOverlay();
    }
  };

  const onWheel = useCallback(
    (e: WheelEvent) => {
      if (!getWorkspace()) return;
      e.preventDefault();
      const r = containerRef.current!.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      // Trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels step larger.
      const k = e.ctrlKey ? 0.01 : 0.0015;
      const factor = Math.exp(-e.deltaY * k);
      zoomAt(cx, cy, viewRef.current.scale * factor);
    },
    [zoomAt],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  // ---------- split handle ----------

  const onSplitDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "split" };
  };
  const onSplitMove = (e: React.PointerEvent) => {
    if (dragRef.current?.kind !== "split") return;
    const p = local(e);
    useEditor.getState().set({ split: Math.min(0.995, Math.max(0.005, p.x / sizeRef.current.w)) });
  };
  const onSplitKey = (e: React.KeyboardEvent) => {
    const d = e.shiftKey ? 0.1 : 0.02;
    const s = useEditor.getState().split;
    if (e.key === "ArrowLeft") useEditor.getState().set({ split: Math.max(0.005, s - d) });
    if (e.key === "ArrowRight") useEditor.getState().set({ split: Math.min(0.995, s + d) });
  };

  const toolCursor = tool === "pan" ? "grab" : tool === "box" ? "crosshair" : "none";
  const effectiveCursor = cursor !== "default" ? cursor : toolCursor;
  const busy = status === "enhancing" || status === "detecting";

  return (
    <div
      ref={containerRef}
      className="checker relative h-full w-full overflow-hidden"
      style={{ cursor: effectiveCursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => {
        pointerRef.current = null;
        drawOverlay();
      }}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="viewport"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {compare === "split" && (
        <div
          className="absolute inset-y-0 z-10 -ml-3 w-6 cursor-ew-resize"
          style={{ left: `${split * 100}%` }}
          onPointerDown={onSplitDown}
          onPointerMove={onSplitMove}
          onPointerUp={() => (dragRef.current = null)}
          role="slider"
          aria-label="Before/after divider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split * 100)}
          tabIndex={0}
          onKeyDown={onSplitKey}
          data-testid="split-handle"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/70 shadow-[0_0_12px_rgba(59,130,246,0.8)]" />
          <div className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-[#0e1525]/80 text-white shadow-glow backdrop-blur-md">
            <MoveHorizontal size={15} />
          </div>
        </div>
      )}

      <PaneLabels compare={compare} split={split} />

      <AnimatePresence>
        {busy && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="glass pointer-events-none absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] text-ink"
            data-testid="busy"
          >
            <Loader2 size={13} className="animate-spin text-accent-soft" />
            {status === "detecting" ? "Detecting subject…" : "Restoring focus…"}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PaneLabels({ compare, split }: { compare: string; split: number }) {
  const tag = "pointer-events-none absolute top-4 z-10 rounded-md border border-white/10 bg-black/45 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/80 backdrop-blur";
  if (compare === "split")
    return (
      <>
        <span className={clsx(tag, "transition-opacity", split < 0.08 && "opacity-0")} style={{ left: 16 }}>
          Before
        </span>
        <span className={clsx(tag, "transition-opacity", split > 0.92 && "opacity-0")} style={{ right: 16 }}>
          After
        </span>
      </>
    );
  if (compare === "side")
    return (
      <>
        <span className={tag} style={{ left: 16 }}>
          Before
        </span>
        <span className={tag} style={{ left: "calc(50% + 16px)" }}>
          After
        </span>
      </>
    );
  return (
    <span className={tag} style={{ left: 16 }}>
      {compare === "before" ? "Before" : "After"}
    </span>
  );
}
