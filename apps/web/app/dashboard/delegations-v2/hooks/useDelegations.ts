"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DelegationRecord, JsonSafeDelegation, DelegationFilters, DelegationStats } from "../types/delegation";

function loadDelegations(owner: string): Map<string, JsonSafeDelegation> {
  try {
    const raw = localStorage.getItem(`kairos:delegations:${owner}`);
    if (!raw) return new Map();
    const entries: [string, JsonSafeDelegation][] = JSON.parse(raw);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function saveDelegations(owner: string, map: Map<string, JsonSafeDelegation>) {
  try {
    localStorage.setItem(`kairos:delegations:${owner}`, JSON.stringify(Array.from(map.entries())));
  } catch {}
}

export function useDelegations(walletOwner: string | null) {
  const [delegations, setDelegations] = useState<DelegationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DelegationStats>({
    activeCount: 0,
    totalValue: 0,
    activeAgents: 0,
    policiesAttached: 0,
    revokedCount: 0,
    pendingRequests: 0,
  });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  const fullDelegationsRef = useRef<Map<string, JsonSafeDelegation>>(new Map());

  useEffect(() => {
    if (walletOwner) {
      fullDelegationsRef.current = loadDelegations(walletOwner);
    }
  }, [walletOwner]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "LIST_DELEGATIONS" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const fromChain: DelegationRecord[] = (data.delegations ?? []).map(
        (d: { hash: string; disabled: boolean; delegator: string }) => ({
          ...d,
          full: fullDelegationsRef.current.get(d.hash),
        })
      );

      const chainHashes = new Set(fromChain.map((d) => d.hash));
      const sessionOnly: DelegationRecord[] = Array.from(fullDelegationsRef.current.entries())
        .filter(([hash]) => !chainHashes.has(hash))
        .map(([hash, full]) => ({ hash, disabled: false, delegator: full.delegator, full }));

      const all = [...sessionOnly, ...fromChain];
      setDelegations(all);

      setStats({
        activeCount: all.filter((d) => !d.disabled).length,
        totalValue: 0,
        activeAgents: 0,
        policiesAttached: all.reduce((acc, d) => acc + (d.full?.caveats.length ?? 0), 0),
        revokedCount: all.filter((d) => d.disabled).length,
        pendingRequests: 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createDelegation = useCallback(async (delegate: string, policies: Record<string, unknown>[]) => {
    const res = await fetch("/api/delegate-sdk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "CREATE_DELEGATION", delegate, policies }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    fullDelegationsRef.current.set(data.hash, data.delegation as JsonSafeDelegation);
    if (walletOwner) saveDelegations(walletOwner, fullDelegationsRef.current);
    await refresh();
    return data.hash;
  }, [walletOwner, refresh]);

  const revoke = useCallback(async (d: DelegationRecord) => {
    if (!d.full) return;
    setActionLoading(d.hash);
    setActionErrors((prev) => ({ ...prev, [d.hash]: "" }));
    try {
      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVOKE_DELEGATION", delegation: d.full }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDelegations((prev) => prev.map((x) => (x.hash === d.hash ? { ...x, disabled: true } : x)));
      setStats((prev) => ({
        ...prev,
        activeCount: Math.max(0, prev.activeCount - 1),
        revokedCount: prev.revokedCount + 1,
      }));
    } catch (e) {
      setActionErrors((prev) => ({ ...prev, [d.hash]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setActionLoading(null);
    }
  }, []);

  const enable = useCallback(async (d: DelegationRecord) => {
    if (!d.full) return;
    setActionLoading(d.hash);
    setActionErrors((prev) => ({ ...prev, [d.hash]: "" }));
    try {
      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ENABLE_DELEGATION", delegation: d.full }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDelegations((prev) => prev.map((x) => (x.hash === d.hash ? { ...x, disabled: false } : x)));
      setStats((prev) => ({
        ...prev,
        activeCount: prev.activeCount + 1,
        revokedCount: Math.max(0, prev.revokedCount - 1),
      }));
    } catch (e) {
      setActionErrors((prev) => ({ ...prev, [d.hash]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setActionLoading(null);
    }
  }, []);

  const filteredDelegations = useCallback((filters: DelegationFilters): DelegationRecord[] => {
    let result = [...delegations];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (d) =>
          d.hash.toLowerCase().includes(q) ||
          d.delegator.toLowerCase().includes(q) ||
          d.full?.delegate.toLowerCase().includes(q)
      );
    }

    if (filters.status !== "all") {
      const isActive = filters.status === "active";
      result = result.filter((d) => d.disabled !== isActive);
    }

    switch (filters.sort) {
      case "newest":
        result.sort((a, b) => b.hash.localeCompare(a.hash));
        break;
      case "oldest":
        result.sort((a, b) => a.hash.localeCompare(b.hash));
        break;
      case "value":
        break;
      case "activity":
        break;
    }

    return result;
  }, [delegations]);

  return {
    delegations,
    stats,
    loading,
    error,
    actionLoading,
    actionErrors,
    refresh,
    createDelegation,
    revoke,
    enable,
    filteredDelegations,
  };
}
