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
    <Card className="p-6">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
        {label}
      </p>
      {loading ? (
        <div className="mt-2 h-8 w-28 animate-pulse rounded-md bg-bg-elevated/60" />
      ) : (
        <p
          className={cn(
            "mt-1.5 font-display text-3xl font-bold tracking-tight tabular-nums text-text-primary",
            valueClassName
          )}
        >
          {value}
        </p>
      )}
      {sub && !loading && (
        <p className="mt-1.5 text-xs text-text-secondary tabular-nums">{sub}</p>
      )}
    </Card>
  );
}
