"use client";

import { clsx } from "clsx";
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "icon";
  active?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-[#4b8ff8] to-[#2f6fe0] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_6px_20px_-6px_rgba(59,130,246,0.7)] hover:from-[#5b9bff] hover:to-[#387aee] disabled:from-[#2a3954] disabled:to-[#24324b] disabled:text-ink-faint disabled:shadow-none",
  secondary:
    "border border-line bg-[#162036] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-[#2a3a55] hover:bg-[#1a2640]",
  ghost: "text-ink-muted hover:bg-white/[0.04] hover:text-ink",
  danger: "text-ink-muted hover:bg-red-500/10 hover:text-red-300",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", active, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        "focus-ring inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-[12.5px]",
        size === "md" && "h-9 px-3.5 text-[13px]",
        size === "icon" && "h-8 w-8",
        variants[variant],
        active && "bg-accent/15 text-accent-soft shadow-[0_0_0_1px_rgba(59,130,246,0.45)]",
        className,
      )}
      {...rest}
    />
  );
});
