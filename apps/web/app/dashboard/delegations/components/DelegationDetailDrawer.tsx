"use client";

import { useCallback, useState } from "react";
import { Spinner } from "@/app/components/ui/Spinner";
import type { DelegationRecord } from "../types/delegation";

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

/** True if a caveat's terms are the `0xFE ++ policy_id:u64_be` indirection marker rather
 *  than inline policy bytes — only these are editable via `set_policy` without minting a
 *  new delegation (see packages/sdk PolicyModule.createIndexed). */
function isIndexedPolicy(terms: number[]): boolean {
  return terms.length === 9 && terms[0] === 0xfe;
}

function decodePolicyId(terms: number[]): number {
  const buf = Buffer.from(terms.slice(1));
  return Number(buf.readBigUInt64BE(0));
}

function describeCaveat(terms: number[]): string {
  try {
    if (isIndexedPolicy(terms)) return "Editable policy";
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

/** Inline form to update an indirected policy's terms in place — no new delegation minted. */
function PolicyEditForm({
  policyId,
  onSubmit,
  onCancel,
  isSaving,
}: {
  policyId: number;
  onSubmit: (params: Record<string, unknown>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [type, setType] = useState<"spend-limit" | "time-restriction" | "target-whitelist">("spend-limit");
  const [token, setToken] = useState("");
  const [spendLimit, setSpendLimit] = useState("");
  const [period, setPeriod] = useState("86400");
  const [target, setTarget] = useState("");
  const [start, setStart] = useState("0");
  const [expiry, setExpiry] = useState("");

  const handleSubmit = () => {
    if (type === "spend-limit") {
      onSubmit({ type, token, spendLimit, period: Number(period) });
    } else if (type === "target-whitelist") {
      onSubmit({ type, target });
    } else {
      onSubmit({ type, start: Number(start), expiry: Number(expiry) });
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-white/5 bg-white/[0.02] p-3">
      <select
        value={type}
        onChange={(e) => setType(e.target.value as typeof type)}
        className="w-full rounded-md border border-white/10 bg-bg-primary px-2 py-1 text-[11px] text-text-primary"
      >
        <option value="spend-limit">Spend Limit</option>
        <option value="target-whitelist">Target Whitelist</option>
        <option value="time-restriction">Time Restriction</option>
      </select>
      {type === "spend-limit" && (
        <>
          <input
            placeholder="Token contract address"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-bg-primary px-2 py-1 text-[11px] font-mono text-text-primary"
          />
          <div className="flex gap-2">
            <input
              placeholder="Limit (stroops)"
              value={spendLimit}
              onChange={(e) => setSpendLimit(e.target.value)}
              className="w-1/2 rounded-md border border-white/10 bg-bg-primary px-2 py-1 text-[11px] text-text-primary"
            />
            <input
              placeholder="Period (seconds)"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-1/2 rounded-md border border-white/10 bg-bg-primary px-2 py-1 text-[11px] text-text-primary"
            />
          </div>
        </>
      )}
      {type === "target-whitelist" && (
        <input
          placeholder="Allowed target address"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="w-full rounded-md border border-white/10 bg-bg-primary px-2 py-1 text-[11px] font-mono text-text-primary"
        />
      )}
      {type === "time-restriction" && (
        <div className="flex gap-2">
          <input
            placeholder="Start (unix seconds)"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-1/2 rounded-md border border-white/10 bg-bg-primary px-2 py-1 text-[11px] text-text-primary"
          />
          <input
            placeholder="Expiry (unix seconds)"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="w-1/2 rounded-md border border-white/10 bg-bg-primary px-2 py-1 text-[11px] text-text-primary"
          />
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={isSaving}
          className="flex-1 rounded-md bg-emerald-600/80 hover:bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors disabled:opacity-40 cursor-pointer"
        >
          {isSaving ? "Saving…" : `Save (policy_id ${policyId})`}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-white/10 px-3 py-1.5 text-[11px] text-text-muted hover:text-text-secondary cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
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
  onUpdatePolicy,
  actionLoading,
  actionErrors,
}: {
  delegation: DelegationRecord;
  onClose: () => void;
  onRevoke: (d: DelegationRecord) => void;
  onEnable: (d: DelegationRecord) => void;
  onDuplicate?: (d: DelegationRecord) => void;
  onUpdatePolicy?: (policyId: number, policy: Record<string, unknown>) => Promise<void>;
  actionLoading: string | null;
  actionErrors: Record<string, string>;
}) {
  const isLoading = actionLoading === delegation.hash;
  const error = actionErrors[delegation.hash];
  const [editingPolicyId, setEditingPolicyId] = useState<number | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const handleSavePolicy = useCallback(
    async (policyId: number, params: Record<string, unknown>) => {
      if (!onUpdatePolicy) return;
      setSavingPolicy(true);
      try {
        await onUpdatePolicy(policyId, params);
        setEditingPolicyId(null);
      } catch {
        // error surfaced via actionErrors, form stays open so the user can retry
      } finally {
        setSavingPolicy(false);
      }
    },
    [onUpdatePolicy]
  );

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
                {delegation.full.caveats.map((c, i) => {
                  const indexed = isIndexedPolicy(c.terms);
                  const policyId = indexed ? decodePolicyId(c.terms) : null;
                  return (
                    <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-text-primary">{describeCaveat(c.terms)}</span>
                        <span className="text-[10px] font-mono text-text-muted">{c.enforcer.slice(0, 6)}…{c.enforcer.slice(-4)}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-text-muted">
                        {indexed ? `policy_id ${policyId}` : `Terms: ${c.terms.length} bytes`}
                      </p>
                      {indexed && onUpdatePolicy && !delegation.disabled && (
                        editingPolicyId === policyId ? (
                          <PolicyEditForm
                            policyId={policyId!}
                            isSaving={savingPolicy}
                            onCancel={() => setEditingPolicyId(null)}
                            onSubmit={(params) => handleSavePolicy(policyId!, params)}
                          />
                        ) : (
                          <button
                            onClick={() => setEditingPolicyId(policyId)}
                            className="mt-2 text-[11px] text-accent hover:underline cursor-pointer"
                          >
                            Edit policy
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
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
