"use client";

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

export function ConfirmRevokeDialog({
  open,
  delegations,
  onClose,
  onConfirm,
}: {
  open: boolean;
  delegations: DelegationRecord[];
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open || delegations.length === 0) return null;

  const isBatch = delegations.length > 1;
  const visible = delegations.slice(0, 3);
  const remaining = delegations.length - 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 bg-bg-primary border border-white/5 rounded-2xl shadow-2xl animate-fade-in-up p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-error/10">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-error">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div>
            <h2 className="font-display text-sm font-medium text-text-primary">
              {isBatch ? `Revoke ${delegations.length} Delegations?` : "Revoke Delegation?"}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              This action is irreversible. The delegate will immediately lose access.
            </p>
          </div>
        </div>

        <div className="space-y-2 mb-5 max-h-48 overflow-y-auto">
          {visible.map((d) => (
            <div key={d.hash} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-text-primary">{shortHash(d.hash)}</span>
                <span className={`text-[10px] font-mono font-medium ${d.disabled ? "text-error" : "text-success"}`}>
                  {d.disabled ? "Disabled" : "Active"}
                </span>
              </div>
              {d.full && (
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-muted">
                  <span>→ {shortAddress(d.full.delegate)}</span>
                  {d.full.caveats.length > 0 && (
                    <>
                      <span className="h-3 w-px bg-white/5" />
                      <span>{d.full.caveats.map((c) => describeCaveat(c.terms)).join(", ")}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {remaining > 0 && (
            <p className="text-center text-[11px] text-text-muted py-1">
              and {remaining} more delegation{remaining !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-all duration-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-red-600/80 px-4 py-2.5 text-xs font-semibold text-white hover:bg-red-600 transition-all duration-200 cursor-pointer"
          >
            {isBatch ? `Revoke ${delegations.length} Delegation${delegations.length !== 1 ? "s" : ""}` : "Confirm Revoke"}
          </button>
        </div>
      </div>
    </div>
  );
}
