"use client";

import type { DelegationStats } from "../types/delegation";
import { StatCard } from "@/app/components/ui/StatCard";

export function StatsCards({
  stats,
  loading,
}: {
  stats: DelegationStats;
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <StatCard
        label="Active Delegations"
        value={stats.activeCount}
        sub={loading ? undefined : "Currently active"}
        loading={loading}
      />
      <StatCard
        label="Policies"
        value={stats.policiesAttached}
        sub={loading ? undefined : "Total caveats active"}
        loading={loading}
      />
      <StatCard
        label="Revoked"
        value={stats.revokedCount}
        sub={loading ? undefined : "Previously revoked"}
        loading={loading}
        valueClassName={stats.revokedCount > 0 ? "text-error" : undefined}
      />
    </div>
  );
}
