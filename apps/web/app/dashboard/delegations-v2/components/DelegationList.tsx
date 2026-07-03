"use client";

import type { DelegationRecord } from "../types/delegation";
import { DelegationCard } from "./DelegationCard";

export function DelegationList({
  delegations,
  onRevoke,
  onEnable,
  onView,
  actionLoading,
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
  selectMode?: boolean;
  selectedHashes?: Set<string>;
  onToggleSelect?: (hash: string) => void;
  onDuplicate?: (d: DelegationRecord) => void;
}) {
  if (delegations.length === 0) return null;

  return (
    <div className="space-y-3">
      {delegations.map((d) => (
        <DelegationCard
          key={d.hash}
          delegation={d}
          onRevoke={onRevoke}
          onEnable={onEnable}
          onView={onView}
          actionLoading={actionLoading}
          selectMode={selectMode}
          selected={selectedHashes?.has(d.hash)}
          onToggleSelect={onToggleSelect}
          onDuplicate={onDuplicate}
        />
      ))}
    </div>
  );
}
