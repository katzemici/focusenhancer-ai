"use client";

import * as RSwitch from "@radix-ui/react-switch";
import { useId } from "react";

export function Switch({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={id} className="cursor-pointer text-[13px] text-ink">
        {label}
      </label>
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        data-testid={testId}
        className="focus-ring relative h-[18px] w-8 rounded-full border border-line bg-base transition-colors data-[state=checked]:border-accent/60 data-[state=checked]:bg-accent/80"
      >
        <RSwitch.Thumb className="block h-3 w-3 translate-x-[2px] rounded-full bg-ink-muted shadow transition-transform duration-150 data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-white" />
      </RSwitch.Root>
    </div>
  );
}
