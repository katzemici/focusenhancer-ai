"use client";

import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { clsx } from "clsx";
import { motion } from "framer-motion";
import { useId, type ReactNode } from "react";
import { Tip } from "./Hint";

export interface SegmentOption<T extends string> {
  value: T;
  label?: string;
  icon?: ReactNode;
  tip?: ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: SegmentOption<T>[];
  size?: "sm" | "md";
  ariaLabel: string;
  className?: string;
  stretch?: boolean;
}

/** Segmented control with an animated selection pill. */
export function Segmented<T extends string>({ value, onChange, options, size = "md", ariaLabel, className, stretch }: SegmentedProps<T>) {
  const layoutId = useId();
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={ariaLabel}
      className={clsx("relative flex rounded-lg border border-line bg-base/60 p-0.5", stretch && "w-full", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        const item = (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            aria-label={o.label ?? o.value}
            data-testid={`seg-${o.value}`}
            className={clsx(
              "focus-ring relative flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]",
              stretch && "flex-1",
              active ? "text-white" : "text-ink-muted hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-md bg-gradient-to-b from-[#24365a] to-[#1a2742] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(59,130,246,0.35)]"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
          </ToggleGroup.Item>
        );
        return o.tip ? (
          <Tip key={o.value} content={o.tip}>
            {item}
          </Tip>
        ) : (
          item
        );
      })}
    </ToggleGroup.Root>
  );
}
