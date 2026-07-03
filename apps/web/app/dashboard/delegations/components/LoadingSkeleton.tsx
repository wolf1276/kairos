export function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
          <div className="h-3 w-24 animate-pulse rounded bg-bg-elevated/60" />
          <div className="mt-3 h-8 w-20 animate-pulse rounded bg-bg-elevated/60" />
          <div className="mt-2 h-3 w-16 animate-pulse rounded bg-bg-elevated/60" />
        </div>
      ))}
    </div>
  );
}

export function DelegationListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-white/5 bg-white/[0.02] p-5"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-bg-elevated/60" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 animate-pulse rounded bg-bg-elevated/60" />
              <div className="h-3 w-32 animate-pulse rounded bg-bg-elevated/60" />
            </div>
            <div className="h-6 w-16 animate-pulse rounded-lg bg-bg-elevated/60" />
          </div>
          <div className="mt-4 flex gap-3">
            <div className="h-4 w-20 animate-pulse rounded bg-bg-elevated/60" />
            <div className="h-4 w-24 animate-pulse rounded bg-bg-elevated/60" />
            <div className="h-4 w-16 animate-pulse rounded bg-bg-elevated/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
