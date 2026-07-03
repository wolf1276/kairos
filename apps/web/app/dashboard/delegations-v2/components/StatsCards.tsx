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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <StatCard
        label="Active Delegations"
        value={stats.activeCount}
        sub={loading ? undefined : "Currently active"}
        loading={loading}
      />
      <StatCard
        label="Total Delegated"
        value={stats.totalValue > 0 ? `$${stats.totalValue.toLocaleString()}` : "—"}
        sub={loading ? undefined : "Across all delegations"}
        loading={loading}
      />
      <StatCard
        label="Active Agents"
        value={stats.activeAgents}
        sub={loading ? undefined : "Running autonomously"}
        loading={loading}
        valueClassName={stats.activeAgents > 0 ? "text-success" : undefined}
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
      <StatCard
        label="Pending"
        value={stats.pendingRequests}
        sub={loading ? undefined : "Awaiting action"}
        loading={loading}
        valueClassName={stats.pendingRequests > 0 ? "text-warning" : undefined}
      />
    </div>
  );
}
