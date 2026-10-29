"use client";

import { useEditor } from "@/store/editor";

const TOOL_HINTS = {
  brush: "Paint over the blurry subject · Alt erases · [ ] size",
  box: "Drag a box around the subject · Alt subtracts",
  pan: "Drag to pan · scroll to zoom",
} as const;

export function StatusBar() {
  const tool = useEditor((s) => s.tool);
  const status = useEditor((s) => s.status);
  const resultStale = useEditor((s) => s.resultStale);
  const hasResult = useEditor((s) => s.hasResult);
  const file = useEditor((s) => s.file);

  const state =
    status === "enhancing"
      ? { dot: "bg-accent animate-pulse", text: "Processing" }
      : status === "detecting"
        ? { dot: "bg-accent animate-pulse", text: "Detecting" }
        : resultStale
          ? { dot: "bg-amber-400", text: "Preview out of date" }
          : hasResult
            ? { dot: "bg-emerald-400", text: "Up to date" }
            : { dot: "bg-ink-faint", text: "No enhancement yet" };

  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-line bg-base/90 px-4 text-[11.5px] text-ink-faint">
      <span className="flex items-center gap-1.5" data-testid="status">
        <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
        {state.text}
      </span>
      <span className="hidden md:inline">{TOOL_HINTS[tool]}</span>
      <span className="ml-auto hidden items-center gap-3 lg:flex">
        <span>
          <span className="kbd">Space</span> pan
        </span>
        <span>
          <span className="kbd">\</span> peek original
        </span>
        <span>
          <span className="kbd">C</span> compare
        </span>
        <span>
          <span className="kbd">V</span> mask
        </span>
        {file?.downscaled && <span className="text-amber-300/80">Resized from {file.sourceWidth}×{file.sourceHeight}</span>}
      </span>
    </footer>
  );
}
