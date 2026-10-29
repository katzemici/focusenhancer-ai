"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Cpu, Lock, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { isAccepted } from "@/lib/image";
import { useEditor } from "@/store/editor";

function firstAccepted(list: FileList | null | undefined): File | null {
  if (!list) return null;
  for (const f of Array.from(list)) if (isAccepted(f)) return f;
  return null;
}

/** Window-level drag-and-drop. Shows a full-screen target while a file is dragged over. */
export function useWindowDrop(onFile: (f: File) => void) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const f = firstAccepted(e.dataTransfer?.files);
      if (f) onFile(f);
      else useEditor.getState().toast("error", "Unsupported file. Drop a PNG, JPEG, WebP or WebM.");
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, [onFile]);
  return over;
}

export function DropOverlay({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-base/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.96 }}
            animate={{ scale: 1 }}
            className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent/70 px-16 py-12 shadow-glow"
          >
            <Upload className="text-accent-soft" size={28} />
            <div className="text-[15px] font-medium text-white">Drop to open</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function EmptyState({ onOpen, loading }: { onOpen: () => void; loading: boolean }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <motion.button
        type="button"
        onClick={onOpen}
        disabled={loading}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        whileHover={{ y: -2 }}
        className={clsx(
          "focus-ring group relative flex w-full max-w-[560px] flex-col items-center overflow-hidden rounded-3xl border border-line bg-panel/50 px-10 py-14 text-center shadow-glass backdrop-blur-xl transition-colors",
          "hover:border-accent/50",
        )}
        data-testid="dropzone"
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[420px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl transition-opacity group-hover:opacity-100" />
        <div className="relative mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-gradient-to-b from-[#1b2a4a] to-[#121c33] shadow-glow">
          {loading ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-soft border-t-transparent" />
          ) : (
            <Upload size={22} className="text-accent-soft" />
          )}
        </div>
        <h1 className="relative text-[20px] font-semibold tracking-tight text-white">
          {loading ? "Decoding image…" : "Drop a photo to restore focus"}
        </h1>
        <p className="relative mt-2 max-w-[400px] text-[13.5px] leading-relaxed text-ink-muted">
          PNG, JPEG, WebP, or a frame from a WebM clip, up to 40 megapixels. The subject is detected automatically, and you can refine the selection with the brush or box tool.
        </p>
        <span className="relative mt-6 inline-flex h-9 items-center rounded-lg bg-gradient-to-b from-[#4b8ff8] to-[#2f6fe0] px-4 text-[13px] font-medium text-white shadow-[0_6px_20px_-6px_rgba(59,130,246,0.7)]">
          Choose file
        </span>
        <div className="relative mt-8 grid w-full grid-cols-3 gap-3 text-left">
          <Feature icon={<Lock size={14} />} title="Private" text="Processed on your device" />
          <Feature icon={<ShieldCheck size={14} />} title="No hallucination" text="Physical PSF inversion" />
          <Feature icon={<Cpu size={14} />} title="Off main thread" text="Web Worker engine" />
        </div>
      </motion.button>
    </div>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-line bg-base/40 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink">
        <span className="text-accent-soft">{icon}</span>
        {title}
      </div>
      <div className="text-[11.5px] text-ink-faint">{text}</div>
    </div>
  );
}
