"use client";

import * as RSlider from "@radix-ui/react-slider";
import { clsx } from "clsx";
import { Hint } from "./Hint";

interface SliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Fires once when the user releases the thumb. */
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Double-clicking the label resets to this value. */
  defaultValue?: number;
  format?: (v: number) => string;
  hint?: string;
  disabled?: boolean;
  testId?: string;
  /** "hot" recolours the fill for values in the extreme (>100%) range. */
  tone?: "normal" | "hot";
}

export function Slider({
  label,
  value,
  onChange,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  defaultValue,
  format = (v) => `${Math.round(v)}%`,
  hint,
  disabled,
  testId,
  tone = "normal",
}: SliderProps) {
  const reset = () => {
    if (defaultValue === undefined || disabled) return;
    onChange(defaultValue);
    onCommit?.(defaultValue);
  };
  return (
    <div className={clsx("group select-none", disabled && "opacity-40")} data-testid={testId}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onDoubleClick={reset}
            className="focus-ring rounded text-[13px] font-medium text-ink"
            title={defaultValue !== undefined ? "Double-click to reset" : undefined}
            tabIndex={-1}
          >
            {label}
          </button>
          {hint && <Hint text={hint} />}
        </div>
        <span className="font-mono text-[12px] tabular-nums text-ink-muted" data-testid={testId && `${testId}-value`}>
          {format(value)}
        </span>
      </div>
      <RSlider.Root
        className="relative flex h-5 w-full touch-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(v[0])}
        onValueCommit={(v) => onCommit?.(v[0])}
        aria-label={label}
      >
        <RSlider.Track className="relative h-[3px] grow overflow-hidden rounded-full bg-line">
          <RSlider.Range
            className={clsx(
              "absolute h-full rounded-full bg-gradient-to-r",
              tone === "hot" ? "from-accent via-amber-400 to-red-500" : "from-accent-deep to-accent",
            )}
          />
        </RSlider.Track>
        {defaultValue !== undefined && (
          <span
            aria-hidden
            className="pointer-events-none absolute h-2 w-px bg-ink-faint/50"
            style={{ left: `${((defaultValue - min) / (max - min)) * 100}%` }}
          />
        )}
        <RSlider.Thumb
          className={clsx(
            "block h-3.5 w-3.5 rounded-full border border-accent/80 bg-[#dbe7ff] shadow-[0_0_0_4px_rgba(59,130,246,0.15)]",
            "transition-[box-shadow,transform] duration-150 hover:scale-110 hover:shadow-[0_0_0_6px_rgba(59,130,246,0.2)]",
            "focus-visible:shadow-[0_0_0_6px_rgba(59,130,246,0.35)] focus-visible:outline-none",
          )}
          aria-valuetext={format(value)}
        />
      </RSlider.Root>
    </div>
  );
}
