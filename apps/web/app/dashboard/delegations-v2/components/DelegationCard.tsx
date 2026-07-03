"use client";

import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import type { DelegationRecord } from "../types/delegation";

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function describeCaveat(terms: number[]): string {
  try {
    const buf = Buffer.from(terms);
    if (buf.length === 0) return "Unknown policy";
    const typeTag = buf.readUInt8(0);
    if (typeTag === 1) return "Target whitelist";
    if (typeTag === 2) return "Spend limit";
    if (typeTag === 3) return "Time restriction";
    return "Unknown policy";
  } catch {
    return "Unreadable policy";
  }
}

function calcHealthScore(d: DelegationRecord): { score: number; label: string; color: string } {
  if (d.disabled) return { score: 0, label: "Inactive", color: "text-text-muted" };
  const policies = d.full?.caveats.length ?? 0;
  if (policies >= 3) return { score: 3, label: "Strong", color: "text-success" };
  if (policies >= 1) return { score: 2, label: "Moderate", color: "text-amber-400" };
  return { score: 1, label: "Unrestricted", color: "text-error" };
}

export function DelegationCard({
  delegation,
  onRevoke,
  onEnable,
  onView,
  actionLoading,
  selectMode,
  selected,
  onToggleSelect,
  onDuplicate,
}: {
  delegation: DelegationRecord;
  onRevoke: (d: DelegationRecord) => void;
  onEnable: (d: DelegationRecord) => void;
  onView: (d: DelegationRecord) => void;
  actionLoading: string | null;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (hash: string) => void;
  onDuplicate?: (d: DelegationRecord) => void;
}) {
  const isLoading = actionLoading === delegation.hash;
  const { hash, disabled, full } = delegation;
  const policyCount = full?.caveats.length ?? 0;
  const health = calcHealthScore(delegation);

  return (
    <div
      className={`group relative rounded-2xl border transition-all duration-500 ${
        selected
          ? "border-accent/30 bg-accent-muted/20"
          : disabled
            ? "border-white/5 bg-white/[0.01] opacity-60"
            : isLoading
              ? "border-accent/20 bg-white/[0.03] animate-glow-subtle"
              : "border-white/5 bg-white/[0.02] hover:border-accent/15 hover:bg-white/[0.03] hover:shadow-[0_8px_30px_-8px_rgba(0,0,0,0.3)]"
      }`}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          {/* Left: identity */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {selectMode && (
              <button
                onClick={() => onToggleSelect?.(hash)}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all duration-200 cursor-pointer ${
                  selected
                    ? "border-accent bg-accent text-white"
                    : "border-white/10 bg-transparent hover:border-white/20"
                }`}
              >
                {selected && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )}
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                disabled ? "bg-bg-elevated/50" : "bg-accent-muted/60"
              }`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke={disabled ? "var(--color-text-muted)" : "var(--color-accent)"}
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-medium text-text-primary truncate">
                  {shortHash(hash)}
                </span>
                <Badge tone={disabled ? "error" : "success"} dot>
                  {disabled ? "Disabled" : "Active"}
                </Badge>
                <span className={`text-[10px] font-mono ${health.color}`}>
                  {health.label}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                <span className="truncate" title={delegation.delegator}>
                  {shortAddress(delegation.delegator)}
                </span>
                <span className="h-3 w-px bg-white/5" />
                {full && (
                  <span className="truncate" title={full.delegate}>
                    → {shortAddress(full.delegate)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: quick actions */}
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onView(delegation)}
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-all duration-200 cursor-pointer"
              title="View details"
            >
              View
            </button>
            {onDuplicate && (
              <button
                onClick={() => onDuplicate(delegation)}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-all duration-200 cursor-pointer"
                title="Duplicate"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            )}
            {full && (
              <button
                onClick={() => (disabled ? onEnable(delegation) : onRevoke(delegation))}
                disabled={isLoading}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                  disabled
                    ? "text-success hover:bg-success/8"
                    : "text-error hover:bg-error/8"
                }`}
              >
                {isLoading ? (
                  <Spinner className="h-3 w-3" />
                ) : disabled ? (
                  "Enable"
                ) : (
                  "Revoke"
                )}
              </button>
            )}
          </div>
        </div>

        {/* Details row */}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
          {full && full.caveats.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span className="text-text-secondary">
                {policyCount} polic{policyCount !== 1 ? "ies" : "y"}
              </span>
            </div>
          ) : full ? (
            <span className="text-text-muted">No policies (unrestricted)</span>
          ) : null}

          {full && full.caveats.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {full.caveats.map((c, i) => (
                <span
                  key={i}
                  className="rounded-full border border-white/5 bg-white/[0.02] px-2 py-0.5 text-[10px] text-text-muted"
                >
                  {describeCaveat(c.terms)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
