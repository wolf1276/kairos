import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "success" | "error" | "warning" | "buy" | "sell";

const TONES: Record<Tone, string> = {
  neutral: "bg-bg-elevated text-text-secondary border-border",
  accent: "bg-accent-muted text-accent border-accent/20",
  success: "bg-success/10 text-success border-success/20",
  error: "bg-error/10 text-error border-error/20",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  buy: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  sell: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
        TONES[tone],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
