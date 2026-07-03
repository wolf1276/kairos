"use client";

import type { DelegationStats } from "../types/delegation";

export function DelegationHeader({
  stats,
  onCreateClick,
}: {
  stats: DelegationStats;
  onCreateClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-text-primary">
          Delegations
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Manage access and permissions for your smart wallet
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-4 text-xs text-text-muted sm:flex">
          <span>{stats.activeCount} active</span>
          <span className="h-3 w-px bg-white/5" />
          <span>{stats.policiesAttached} policies</span>
        </div>
        <button
          onClick={onCreateClick}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:bg-accent-hover hover:shadow-[0_0_25px_-8px_rgba(120,81,233,0.3)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create Delegation
        </button>
      </div>
    </div>
  );
}
