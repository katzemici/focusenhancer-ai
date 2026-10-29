"use client";

import { Download, Focus, Image as ImageIcon, Minus, Plus, Scan, X } from "lucide-react";
import { Columns2, SplitSquareHorizontal } from "lucide-react";
import { closeImage, exportImage } from "@/lib/controller";
import { aspectLabel, formatBytes, megapixels } from "@/lib/image";
import { useEditor, type CompareMode } from "@/store/editor";
import { Button } from "./ui/Button";
import { Tip } from "./ui/Hint";
import { Segmented } from "./ui/Segmented";

export function viewCommand(cmd: "fit" | "in" | "out" | "100") {
  window.dispatchEvent(new CustomEvent("fe:view", { detail: cmd }));
}

export function Header({ onOpen }: { onOpen: () => void }) {
  const file = useEditor((s) => s.file);
  const compare = useEditor((s) => s.compare);
  const zoom = useEditor((s) => s.zoom);
  const set = useEditor((s) => s.set);

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-base/80 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#2b5fd9] to-[#123076] shadow-glow">
          <Focus size={16} className="text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-[14px] font-semibold tracking-tight text-white">FocusEnhancer</div>
          <div className="text-[10.5px] text-ink-faint">Natural subject deblurring</div>
        </div>
      </div>

      <div className="mx-2 h-6 w-px bg-line" />

      {file ? (
        <div className="flex min-w-0 items-center gap-3 text-[12px]" data-testid="file-meta">
          <ImageIcon size={14} className="shrink-0 text-ink-faint" />
          <span className="max-w-[220px] truncate font-medium text-ink" title={file.name}>
            {file.name}
          </span>
          <Meta>{`${file.width} × ${file.height}`}</Meta>
          <Meta>{aspectLabel(file.width, file.height)}</Meta>
          <Meta>{megapixels(file.width, file.height)}</Meta>
          <Meta className="hidden xl:inline-flex">{formatBytes(file.size)}</Meta>
          <Tip content="Close image">
            <button type="button" onClick={closeImage} className="focus-ring rounded p-1 text-ink-faint hover:bg-white/5 hover:text-ink" aria-label="Close image">
              <X size={13} />
            </button>
          </Tip>
        </div>
      ) : (
        <span className="text-[12px] text-ink-faint">Runs entirely in your browser. Images are never uploaded.</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {file && (
          <>
            <div className="hidden items-center gap-0.5 rounded-lg border border-line bg-base/60 p-0.5 md:flex">
              <Tip content="Zoom out">
                <button type="button" onClick={() => viewCommand("out")} className="focus-ring rounded-md p-1.5 text-ink-muted hover:bg-white/5 hover:text-ink" aria-label="Zoom out">
                  <Minus size={13} />
                </button>
              </Tip>
              <Tip content="Actual pixels (1)">
                <button type="button" onClick={() => viewCommand("100")} className="focus-ring w-14 rounded-md py-1 font-mono text-[11.5px] tabular-nums text-ink-muted hover:bg-white/5 hover:text-ink" data-testid="zoom">
                  {Math.round(zoom * 100)}%
                </button>
              </Tip>
              <Tip content="Zoom in">
                <button type="button" onClick={() => viewCommand("in")} className="focus-ring rounded-md p-1.5 text-ink-muted hover:bg-white/5 hover:text-ink" aria-label="Zoom in">
                  <Plus size={13} />
                </button>
              </Tip>
              <Tip content="Fit to screen (0)">
                <button type="button" onClick={() => viewCommand("fit")} className="focus-ring rounded-md p-1.5 text-ink-muted hover:bg-white/5 hover:text-ink" aria-label="Fit to screen">
                  <Scan size={13} />
                </button>
              </Tip>
            </div>

            <Segmented<CompareMode>
              ariaLabel="Compare mode"
              size="sm"
              value={compare}
              onChange={(v) => set({ compare: v })}
              options={[
                { value: "split", label: "Split", icon: <SplitSquareHorizontal size={13} />, tip: "Split slider (C cycles modes)" },
                { value: "side", label: "Side", icon: <Columns2 size={13} />, tip: "Side by side, synced pan & zoom" },
                { value: "before", label: "Before", tip: "Original only (hold \\ to peek)" },
                { value: "after", label: "After", tip: "Enhanced only" },
              ]}
            />
            <div className="mx-1 h-6 w-px bg-line" />
            <Button variant="secondary" size="sm" onClick={onOpen}>
              Open
            </Button>
            <Button variant="primary" size="sm" onClick={() => void exportImage()} data-testid="export-btn">
              <Download size={14} />
              Export
            </Button>
          </>
        )}
      </div>
    </header>
  );
}

function Meta({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border border-line bg-panel/60 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-ink-muted ${className}`}>
      {children}
    </span>
  );
}
