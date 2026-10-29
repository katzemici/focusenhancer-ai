"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEditor } from "@/store/editor";

const icons = {
  info: <Info size={15} className="text-accent-soft" />,
  success: <CheckCircle2 size={15} className="text-emerald-400" />,
  error: <AlertCircle size={15} className="text-red-400" />,
};

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-[420px] max-w-[92vw] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="glass pointer-events-auto flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-snug text-ink"
            role={t.kind === "error" ? "alert" : "status"}
            data-testid={`toast-${t.kind}`}
          >
            <span className="mt-px shrink-0">{icons[t.kind]}</span>
            <span className="flex-1">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="focus-ring shrink-0 rounded text-ink-faint hover:text-ink" aria-label="Dismiss">
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
