import { cn } from "@/lib/utils";
import { Card } from "./Card";

/**
 * Placeholder for Kairos modules that don't have a live backend yet
 * (AI agents, policy engine, oracle confidence, risk engine, etc).
 * Renders the real card chrome with no invented numbers.
 */
export function ComingSoon({
  label,
  icon,
  hint,
  className,
  span,
}: {
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  className?: string;
  span?: string;
}) {
  return (
    <Card className={cn("p-6", span, className)}>
      <div className="flex items-start justify-between">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
          {label}
        </p>
        <span className="rounded-full border border-white/5 bg-white/[0.02] px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider text-text-muted/70">
          Coming soon
        </span>
      </div>
      <div className="mt-5 flex flex-col items-start gap-2 opacity-60">
        {icon && <span className="text-text-muted">{icon}</span>}
        <p className="text-xs leading-relaxed text-text-muted">
          {hint ?? "Not connected yet."}
        </p>
      </div>
    </Card>
  );
}
