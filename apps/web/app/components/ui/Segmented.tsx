"use client";

import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex gap-1 rounded-xl border border-white/5 bg-bg-elevated/50 p-1", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 cursor-pointer rounded-[7px] font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
              size === "sm" ? "px-3 py-1 text-[11px]" : "px-4 py-2 text-xs",
              active
                ? "bg-white/8 text-text-primary shadow-[0_0_20px_-8px_rgba(120,81,233,0.15)]"
                : "text-text-muted hover:text-text-secondary"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
