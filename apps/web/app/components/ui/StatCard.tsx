import { cn } from "@/lib/utils";
import { Card } from "./Card";

export function StatCard({
  label,
  value,
  sub,
  valueClassName,
  loading = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueClassName?: string;
  loading?: boolean;
}) {
  return (
    <Card className="p-5">
      <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
        {label}
      </p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-bg-elevated" />
      ) : (
        <p
          className={cn(
            "mt-1 font-display text-2xl font-bold tracking-tight tabular-nums",
            valueClassName
          )}
        >
          {value}
        </p>
      )}
      {sub && !loading && (
        <p className="mt-1 text-xs text-text-secondary tabular-nums">{sub}</p>
      )}
    </Card>
  );
}
