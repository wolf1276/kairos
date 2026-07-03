"use client";

import type { DelegationRecord } from "../types/delegation";
import { DelegationCard } from "./DelegationCard";

export function DelegationList({
  delegations,
  onRevoke,
  onEnable,
  onView,
  actionLoading,
  actionErrors,
  selectMode,
  selectedHashes,
  onToggleSelect,
  onDuplicate,
}: {
  delegations: DelegationRecord[];
  onRevoke: (d: DelegationRecord) => void;
  onEnable: (d: DelegationRecord) => void;
  onView: (d: DelegationRecord) => void;
  actionLoading: string | null;
  actionErrors?: Record<string, string>;
  selectMode?: boolean;
  selectedHashes?: Set<string>;
  onToggleSelect?: (hash: string) => void;
  onDuplicate?: (d: DelegationRecord) => void;
}) {
  if (delegations.length === 0) return null;

  const active = delegations.filter((d) => !d.disabled);
  const revoked = delegations.filter((d) => d.disabled);

  const renderGroup = (group: DelegationRecord[], label: string, count: number) => {
    if (group.length === 0) return null;
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
            {label}
          </h3>
          <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-text-muted">
            {count}
          </span>
        </div>
        <div className="space-y-3">
          {group.map((d) => (
            <DelegationCard
              key={d.hash}
              delegation={d}
              onRevoke={onRevoke}
              onEnable={onEnable}
              onView={onView}
              actionLoading={actionLoading}
              actionErrors={actionErrors}
              selectMode={selectMode}
              selected={selectedHashes?.has(d.hash)}
              onToggleSelect={onToggleSelect}
              onDuplicate={onDuplicate}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {renderGroup(active, "Active", active.length)}
      {renderGroup(revoked, "Revoked", revoked.length)}
    </div>
  );
}
