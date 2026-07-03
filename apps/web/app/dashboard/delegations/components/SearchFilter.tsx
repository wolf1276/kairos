"use client";

import type { DelegationFilters, DelegationStatus, DelegationSort } from "../types/delegation";

export function SearchFilter({
  filters,
  onChange,
  total,
}: {
  filters: DelegationFilters;
  onChange: (filters: DelegationFilters) => void;
  total: number;
}) {
  const update = <K extends keyof DelegationFilters>(key: K, value: DelegationFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const hasActiveFilters = filters.search || filters.status !== "all" || filters.asset;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by hash, delegate, or delegator..."
            value={filters.search}
            onChange={(e) => update("search", e.target.value)}
            className="w-full rounded-xl border border-white/5 bg-white/[0.02] pl-10 pr-4 py-2.5 font-mono text-xs text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
          />
          {filters.search && (
            <button
              onClick={() => update("search", "")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filters.status}
            onChange={(e) => update("status", e.target.value as DelegationStatus | "all")}
            className="rounded-lg border border-white/5 bg-bg-elevated px-3 py-2 font-mono text-xs text-text-secondary outline-none transition-all duration-200 focus:border-accent/30 focus:ring-2 focus:ring-accent/15 cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>

          <select
            value={filters.sort}
            onChange={(e) => update("sort", e.target.value as DelegationSort)}
            className="rounded-lg border border-white/5 bg-bg-elevated px-3 py-2 font-mono text-xs text-text-secondary outline-none transition-all duration-200 focus:border-accent/30 focus:ring-2 focus:ring-accent/15 cursor-pointer"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span>
            {total} result{total !== 1 ? "s" : ""}
          </span>
          <button
            onClick={() => onChange({ search: "", status: "all", asset: "", sort: "newest" })}
            className="text-accent hover:text-accent-hover transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
