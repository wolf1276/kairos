"use client";

import { useState, useCallback } from "react";
import type { Caveat } from "@/app/lib/sdk";
import { createPolicy } from "@/app/lib/sdk";

interface PolicyConfig {
  id: string;
  type: "target-whitelist" | "time-restriction" | "spend-limit";
  target?: string;
  start?: string;
  expiry?: string;
  token?: string;
  spendLimit?: string;
  period?: string;
}

let policyIdCounter = 0;

function nextId(): string {
  policyIdCounter += 1;
  return `policy_${policyIdCounter}`;
}

export default function PolicyEditor({
  caveats,
  onChange,
}: {
  caveats: Caveat[];
  onChange: (caveats: Caveat[]) => void;
}) {
  const [policies, setPolicies] = useState<PolicyConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addPolicy = useCallback((type: PolicyConfig["type"]) => {
    setPolicies((prev) => [
      ...prev,
      { id: nextId(), type },
    ]);
  }, []);

  const updatePolicy = useCallback((id: string, field: string, value: string) => {
    setPolicies((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  }, []);

  const removePolicy = useCallback((id: string) => {
    setPolicies((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const applyPolicies = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const results: Caveat[] = [];
      for (const p of policies) {
        const caveat = await createPolicy({
          type: p.type,
          ...(p.type === "target-whitelist" && p.target ? { target: p.target } : {}),
          ...(p.type === "time-restriction" ? {
            ...(p.start ? { start: BigInt(p.start) } : {}),
            ...(p.expiry ? { expiry: BigInt(p.expiry) } : {}),
          } : {}),
          ...(p.type === "spend-limit" ? {
            ...(p.token ? { token: p.token } : {}),
            ...(p.spendLimit ? { spendLimit: p.spendLimit } : {}),
            ...(p.period ? { period: BigInt(p.period) } : {}),
          } : {}),
        });
        results.push(caveat);
      }
      onChange(results);
      setPolicies([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [policies, onChange]);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-error/20 bg-error/10 px-4 py-3">
          <p className="text-xs text-error">{error}</p>
        </div>
      )}

      {/* Policy type selector */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => addPolicy("target-whitelist")}
          className="rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
        >
          + Target Whitelist
        </button>
        <button
          onClick={() => addPolicy("time-restriction")}
          className="rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
        >
          + Time Restriction
        </button>
        <button
          onClick={() => addPolicy("spend-limit")}
          className="rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
        >
          + Spend Limit
        </button>
      </div>

      {/* Policy forms */}
      {policies.length > 0 && (
        <div className="space-y-3">
          {policies.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-border bg-bg-elevated p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
                  {p.type}
                </span>
                <button
                  onClick={() => removePolicy(p.id)}
                  className="text-[10px] text-error transition-colors hover:text-error/70"
                >
                  Remove
                </button>
              </div>

              {p.type === "target-whitelist" && (
                <input
                  type="text"
                  placeholder="Allowed target address (G… or C…)"
                  value={p.target || ""}
                  onChange={(e) => updatePolicy(p.id, "target", e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 font-mono text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                />
              )}

              {p.type === "time-restriction" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block font-mono text-[9px] uppercase tracking-widest text-text-muted">
                      Start (unix sec)
                    </label>
                    <input
                      type="number"
                      placeholder="0"
                      value={p.start || ""}
                      onChange={(e) => updatePolicy(p.id, "start", e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 font-mono text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-mono text-[9px] uppercase tracking-widest text-text-muted">
                      Expiry (unix sec)
                    </label>
                    <input
                      type="number"
                      placeholder="0"
                      value={p.expiry || ""}
                      onChange={(e) => updatePolicy(p.id, "expiry", e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 font-mono text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {p.type === "spend-limit" && (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Token contract ID (C…)"
                    value={p.token || ""}
                    onChange={(e) => updatePolicy(p.id, "token", e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 font-mono text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Spend limit"
                      value={p.spendLimit || ""}
                      onChange={(e) => updatePolicy(p.id, "spendLimit", e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 font-mono text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                    />
                    <input
                      type="number"
                      placeholder="Period (seconds)"
                      value={p.period || ""}
                      onChange={(e) => updatePolicy(p.id, "period", e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 font-mono text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}

          <button
            onClick={applyPolicies}
            disabled={saving}
            className="w-full rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Applying..." : "Apply Policies to Delegation"}
          </button>
        </div>
      )}

      {/* Applied policies */}
      {caveats.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">
            Applied Policies ({caveats.length})
          </p>
          {caveats.map((c, i) => (
            <div
              key={i}
              className="rounded-lg border border-success/20 bg-success/5 px-3 py-2"
            >
              <p className="font-mono text-[10px] text-success">
                Policy #{i + 1}
              </p>
              <p className="mt-0.5 font-mono text-[9px] text-text-muted break-all">
                Enforcer: {c.enforcer}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
