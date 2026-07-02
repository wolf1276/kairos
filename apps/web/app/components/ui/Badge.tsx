import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "success" | "error" | "warning" | "buy" | "sell";

const TONES: Record<Tone, string> = {
  neutral: "bg-bg-elevated/60 text-text-secondary border-white/4",
  accent: "bg-accent-muted/70 text-accent border-accent/10",
  success: "bg-success/8 text-success/90 border-success/15",
  error: "bg-error/8 text-error/90 border-error/15",
  warning: "bg-amber-500/8 text-amber-400/90 border-amber-500/15",
  buy: "bg-emerald-500/8 text-emerald-400/85 border-emerald-500/15",
  sell: "bg-red-500/8 text-red-400/85 border-red-500/15",
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
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}
