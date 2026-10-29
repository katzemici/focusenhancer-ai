"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

export function Tip({ content, children, side = "bottom" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-[260px] rounded-md border border-line bg-[#0e1525]/95 px-2.5 py-1.5 text-[12px] leading-snug text-ink shadow-glass backdrop-blur-md"
        >
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Hint({ text }: { text: string }) {
  return (
    <Tip content={text} side="left">
      <button type="button" className="focus-ring rounded text-ink-faint hover:text-ink-muted" aria-label={text}>
        <Info size={12} />
      </button>
    </Tip>
  );
}
