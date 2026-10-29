"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { useCallback, useEffect, useRef } from "react";
import { clearMask, loadFile, redo, undo } from "@/lib/controller";
import { ACCEPT_ATTR } from "@/lib/image";
import { useEditor, type CompareMode } from "@/store/editor";
import { DropOverlay, EmptyState, useWindowDrop } from "./Dropzone";
import { Header, viewCommand } from "./Header";
import { Inspector } from "./Inspector";
import { StatusBar } from "./StatusBar";
import { Toasts } from "./Toasts";
import { Viewport } from "./Viewport";

const COMPARE_CYCLE: CompareMode[] = ["split", "side", "before", "after"];

function useShortcuts() {
  useEffect(() => {
    let peekFrom: CompareMode | null = null;
    const down = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const s = useEditor.getState();
      if (!s.file) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod) return;
      switch (k) {
        case "b":
          s.set({ tool: "brush" });
          break;
        case "m":
        case "r":
          s.set({ tool: "box" });
          break;
        case "h":
          s.set({ tool: "pan" });
          break;
        case "x":
          s.set({ maskOp: s.maskOp === "add" ? "subtract" : "add" });
          break;
        case "[":
          s.set({ brushSize: Math.max(4, Math.round(s.brushSize / 1.2)) });
          break;
        case "]":
          s.set({ brushSize: Math.round(s.brushSize * 1.2) });
          break;
        case "v":
          s.set({ showMask: !s.showMask });
          break;
        case "c":
          s.set({ compare: COMPARE_CYCLE[(COMPARE_CYCLE.indexOf(s.compare) + 1) % COMPARE_CYCLE.length] });
          break;
        case "\\":
          if (!e.repeat && s.compare !== "before") {
            peekFrom = s.compare;
            s.set({ compare: "before" });
          }
          break;
        case "0":
          viewCommand("fit");
          break;
        case "1":
          viewCommand("100");
          break;
        case "=":
        case "+":
          viewCommand("in");
          break;
        case "-":
          viewCommand("out");
          break;
        case "delete":
        case "backspace":
          clearMask();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "\\" && peekFrom) {
        useEditor.getState().set({ compare: peekFrom });
        peekFrom = null;
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}

export function Editor() {
  const file = useEditor((s) => s.file);
  const status = useEditor((s) => s.status);
  const inputRef = useRef<HTMLInputElement>(null);

  useShortcuts();

  const open = useCallback(() => inputRef.current?.click(), []);
  const onFile = useCallback((f: File) => void loadFile(f), []);
  const dragging = useWindowDrop(onFile);

  return (
    <Tooltip.Provider delayDuration={350}>
      <div className="flex h-dvh flex-col overflow-hidden bg-base">
        <Header onOpen={open} />
        <main className="relative flex min-h-0 flex-1">
          {file ? (
            <>
              <div className="relative min-w-0 flex-1">
                <Viewport />
              </div>
              <div className="relative z-20 flex shrink-0 border-l border-line bg-base/60 p-3">
                <Inspector />
              </div>
            </>
          ) : (
            <EmptyState onOpen={open} loading={status === "loading"} />
          )}
        </main>
        {file && <StatusBar />}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          data-testid="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        <DropOverlay visible={dragging} />
        <Toasts />
      </div>
    </Tooltip.Provider>
  );
}
