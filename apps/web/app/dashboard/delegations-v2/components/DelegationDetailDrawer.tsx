"use client";

import { useCallback } from "react";
import { Spinner } from "@/app/components/ui/Spinner";
import type { DelegationRecord } from "../types/delegation";

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
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

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-text-muted">{label}</span>
      <span className={`text-[11px] ${mono ? "font-mono" : ""} text-text-secondary truncate ml-4 max-w-[240px] text-right`} title={value}>
        {value}
      </span>
    </div>
  );
}

export function DelegationDetailDrawer({
  delegation,
  onClose,
  onRevoke,
  onEnable,
  onDuplicate,
  actionLoading,
  actionErrors,
}: {
  delegation: DelegationRecord;
  onClose: () => void;
  onRevoke: (d: DelegationRecord) => void;
  onEnable: (d: DelegationRecord) => void;
  onDuplicate?: (d: DelegationRecord) => void;
  actionLoading: string | null;
  actionErrors: Record<string, string>;
}) {
  const isLoading = actionLoading === delegation.hash;
  const error = actionErrors[delegation.hash];

  const handleCopyHash = useCallback(() => {
    navigator.clipboard.writeText(delegation.hash);
  }, [delegation.hash]);

  const handleExportJson = useCallback(() => {
    if (!delegation.full) return;
    const blob = new Blob([JSON.stringify(delegation.full, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delegation-${delegation.hash.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [delegation]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-bg-primary border-l border-white/5 shadow-2xl overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/5 bg-bg-primary/90 backdrop-blur-sm px-6 py-4">
          <h2 className="font-display text-sm font-medium text-text-primary">
            Delegation Details
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Overview */}
          <section>
            <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted mb-3">
              Overview
            </h3>
            <div className="space-y-3">
              <DetailRow label="Hash" value={shortHash(delegation.hash)} mono />
              <DetailRow label="Delegator" value={shortHash(delegation.delegator)} mono />
              {delegation.full && (
                <>
                  <DetailRow label="Delegate" value={shortHash(delegation.full.delegate)} mono />
                  <DetailRow label="Authority" value={shortHash(delegation.full.authority)} mono />
                  <DetailRow label="Nonce" value={delegation.full.nonce} mono />
                  <DetailRow label="Salt" value={delegation.full.salt} mono />
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-muted">Status</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-mono font-medium ${
                  delegation.disabled
                    ? "bg-error/8 text-error"
                    : "bg-success/8 text-success"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${delegation.disabled ? "bg-error" : "bg-success"}`} />
                  {delegation.disabled ? "Revoked" : "Active"}
                </span>
              </div>
            </div>
          </section>

          {/* Caveats */}
          <section>
            <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted mb-3">
              Policies ({delegation.full?.caveats.length ?? 0})
            </h3>
            {delegation.full && delegation.full.caveats.length > 0 ? (
              <div className="space-y-2">
                {delegation.full.caveats.map((c, i) => (
                  <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-text-primary">{describeCaveat(c.terms)}</span>
                      <span className="text-[10px] font-mono text-text-muted">{c.enforcer.slice(0, 6)}…{c.enforcer.slice(-4)}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-text-muted">
                      Terms: {c.terms.length} bytes
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted">No policies attached (unrestricted)</p>
            )}
          </section>

          {/* Actions */}
          <section className="pt-2 border-t border-white/5 space-y-3">
            {error && (
              <div className="rounded-xl border border-error/15 bg-error/6 px-3.5 py-2.5">
                <p className="text-[11px] text-error/90">{error}</p>
              </div>
            )}
            <div className="flex gap-3">
              {delegation.full && (
                <button
                  onClick={() => (delegation.disabled ? onEnable(delegation) : onRevoke(delegation))}
                  disabled={isLoading}
                  className={`flex-1 rounded-xl px-4 py-2.5 text-xs font-semibold text-white transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                    delegation.disabled
                      ? "bg-emerald-600/80 hover:bg-emerald-600"
                      : "bg-red-600/80 hover:bg-red-600"
                  }`}
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Spinner className="h-3 w-3" />
                      Processing…
                    </span>
                  ) : delegation.disabled ? (
                    "Enable Delegation"
                  ) : (
                    "Revoke Delegation"
                  )}
                </button>
              )}
              <button
                onClick={handleCopyHash}
                className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                title="Copy full hash"
              >
                Copy Hash
              </button>
            </div>
            <div className="flex gap-3">
              {delegation.full && (
                <button
                  onClick={handleExportJson}
                  className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-[11px] text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-all duration-200 cursor-pointer"
                >
                  Export JSON
                </button>
              )}
              {onDuplicate && delegation.full && (
                <button
                  onClick={() => onDuplicate(delegation)}
                  className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-[11px] text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-all duration-200 cursor-pointer"
                >
                  Duplicate
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
